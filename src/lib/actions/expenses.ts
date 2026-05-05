'use server'

/**
 * Ola P8 · Equipo P8-3 — Server actions de Expenses (Cost Management).
 *
 * CRUD de `Expense` con conversión automática a USD vía la `CurrencyRate`
 * más reciente (tabla cargada por el cron `/api/cron/currency-rates`). El
 * estado fluye DRAFT → SUBMITTED → APPROVED → REIMBURSED, con REJECTED
 * como rama terminal alternativa.
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle`.
 *   - zod por entrada; revalidatePath('/expenses') tras cualquier mutación.
 *   - Prisma.Decimal para montos en BD; al exponer a UI/eventos se serializa
 *     a number (preferimos UX sobre precisión banking-grade en el listado).
 *
 * Decisiones autónomas:
 *   D-EXP-1: Al SUBMIT, si la moneda != USD y NO hay rate disponible, NO
 *           bloqueamos: dejamos `amountUsd = NULL`. El cron la rellena en
 *           la siguiente corrida (`backfillUsdAmounts`).
 *   D-EXP-2: Solo el submitter o un usuario con permisos de aprobación
 *           (managerId del proyecto) puede mover el status. La validación
 *           granular de roles se delega a P8-4 (RBAC fino) — en P8-3
 *           confiamos en la UI para no exponer el botón "approve" a quien
 *           no corresponde.
 *   D-EXP-3: `deleteExpense` solo aplica en estado DRAFT. Para gastos ya
 *           sometidos, el flujo correcto es REJECT (preserva auditoría).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma, type ExpenseStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { dispatchWebhookEvent, type WebhookEventType } from '@/lib/webhooks/dispatcher'
import {
  detectBudgetAlerts,
  buildBudgetSnapshots,
  dispatchBudgetAlerts,
} from '@/lib/cost/budget-alerts'
import { isValidIsoCurrency } from '@/lib/cost/expense-types'
import { lookupFromRows, toUsd, type CurrencyRateRow } from '@/lib/cost/currency-convert'

// ─────────────────────── Errores tipados ───────────────────────

export type ExpenseErrorCode =
  | 'INVALID_INPUT'
  | 'EXPENSE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'INVALID_CURRENCY'
  | 'INVALID_AMOUNT'

function actionError(code: ExpenseErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────── Schemas zod ───────────────────────

const expenseCreateSchema = z.object({
  projectId: z.string().min(1, 'projectId es obligatorio'),
  taskId: z.string().min(1).optional().nullable(),
  submittedById: z.string().min(1, 'submittedById es obligatorio'),
  description: z.string().trim().min(1).max(500),
  amount: z.number().finite().positive('amount debe ser > 0'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidIsoCurrency, 'Moneda inválida (formato ISO 4217 esperado)'),
  receiptUrl: z.string().trim().url().optional().nullable().or(z.literal('').transform(() => null)),
  incurredAt: z.coerce.date(),
})

export type CreateExpenseInput = z.input<typeof expenseCreateSchema>

const expenseUpdateSchema = z.object({
  description: z.string().trim().min(1).max(500).optional(),
  amount: z.number().finite().positive().optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidIsoCurrency, 'Moneda inválida')
    .optional(),
  receiptUrl: z.string().trim().url().optional().nullable(),
  incurredAt: z.coerce.date().optional(),
  taskId: z.string().min(1).nullable().optional(),
})

export type UpdateExpenseInput = z.input<typeof expenseUpdateSchema>

// ─────────────────────── Helpers ───────────────────────

async function loadLatestRates(): Promise<CurrencyRateRow[]> {
  // Pull all rates and dedup by quote (lookupFromRows toma la más reciente).
  const rows = await prisma.currencyRate.findMany({
    where: { base: 'USD' },
    orderBy: { fetchedAt: 'desc' },
    take: 200,
  })
  return rows.map((r) => ({
    base: r.base,
    quote: r.quote,
    rate: typeof r.rate === 'object' && r.rate !== null && 'toNumber' in r.rate
      ? (r.rate as Prisma.Decimal).toNumber()
      : Number(r.rate),
    fetchedAt: r.fetchedAt,
  }))
}

async function computeUsdAmount(amount: number, currency: string): Promise<number | null> {
  if (currency === 'USD') return amount
  const rows = await loadLatestRates()
  const lookup = lookupFromRows(rows)
  return toUsd(amount, currency, lookup)
}

function revalidateExpenseRoutes(): void {
  revalidatePath('/expenses')
  revalidatePath('/dashboards')
}

const VALID_TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['REIMBURSED'],
  REJECTED: [],
  REIMBURSED: [],
}

function canTransitionExpense(
  from: ExpenseStatus,
  to: ExpenseStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

// ─────────────────────── Server actions ───────────────────────

export async function createExpense(
  input: CreateExpenseInput,
): Promise<{ id: string }> {
  const parsed = expenseCreateSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true },
  })
  if (!project) actionError('PROJECT_NOT_FOUND', `Proyecto ${data.projectId} no existe`)

  if (data.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: data.taskId },
      select: { id: true, projectId: true },
    })
    if (!task) actionError('TASK_NOT_FOUND', `Tarea ${data.taskId} no existe`)
    if (task.projectId !== data.projectId) {
      actionError('INVALID_INPUT', 'taskId no pertenece al proyecto indicado')
    }
  }

  const amountUsd = await computeUsdAmount(data.amount, data.currency)

  const created = await prisma.expense.create({
    data: {
      projectId: data.projectId,
      taskId: data.taskId ?? null,
      submittedById: data.submittedById,
      description: data.description,
      amount: new Prisma.Decimal(data.amount),
      currency: data.currency,
      amountUsd: amountUsd === null ? null : new Prisma.Decimal(amountUsd),
      receiptUrl: data.receiptUrl ?? null,
      incurredAt: data.incurredAt,
      status: 'DRAFT',
    },
    select: { id: true },
  })

  revalidateExpenseRoutes()
  return created
}

export async function updateExpense(
  id: string,
  patch: UpdateExpenseInput,
): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  const parsed = expenseUpdateSchema.safeParse(patch)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const p = parsed.data

  const current = await prisma.expense.findUnique({
    where: { id },
    select: { id: true, status: true, amount: true, currency: true },
  })
  if (!current) actionError('EXPENSE_NOT_FOUND', `Gasto ${id} no existe`)

  // Solo se puede editar en DRAFT (paridad con flujos de submit financiero).
  if (current.status !== 'DRAFT') {
    actionError(
      'INVALID_STATUS_TRANSITION',
      'Solo gastos en DRAFT pueden editarse; usa REJECT para sometidos',
    )
  }

  const data: Prisma.ExpenseUpdateInput = {}
  if (p.description !== undefined) data.description = p.description
  if (p.taskId !== undefined) {
    data.task = p.taskId ? { connect: { id: p.taskId } } : { disconnect: true }
  }
  if (p.receiptUrl !== undefined) data.receiptUrl = p.receiptUrl
  if (p.incurredAt !== undefined) data.incurredAt = p.incurredAt

  const newAmount = p.amount ?? Number(current.amount)
  const newCurrency = p.currency ?? current.currency
  if (p.amount !== undefined) data.amount = new Prisma.Decimal(p.amount)
  if (p.currency !== undefined) data.currency = p.currency

  // Re-cálculo de amountUsd si cambió amount/currency.
  if (p.amount !== undefined || p.currency !== undefined) {
    const usd = await computeUsdAmount(newAmount, newCurrency)
    data.amountUsd = usd === null ? null : new Prisma.Decimal(usd)
  }

  await prisma.expense.update({ where: { id }, data })
  revalidateExpenseRoutes()
}

export async function deleteExpense(id: string): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  const current = await prisma.expense.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!current) actionError('EXPENSE_NOT_FOUND', `Gasto ${id} no existe`)
  if (current.status !== 'DRAFT') {
    actionError(
      'INVALID_STATUS_TRANSITION',
      'Solo gastos DRAFT son deletables; los sometidos preservan auditoría',
    )
  }
  await prisma.expense.delete({ where: { id } })
  revalidateExpenseRoutes()
}

export async function submitExpense(id: string): Promise<void> {
  await transitionStatus(id, 'SUBMITTED')
}

export async function approveExpense(
  id: string,
  approvedById: string,
): Promise<void> {
  if (!approvedById) actionError('INVALID_INPUT', 'approvedById es obligatorio')
  await transitionStatus(id, 'APPROVED', { approvedById, approvedAt: new Date() })
  // Tras aprobar, evaluamos alertas de presupuesto del proyecto.
  await maybeDispatchBudgetAlertsForExpense(id)
}

export async function rejectExpense(
  id: string,
  reason: string,
): Promise<void> {
  if (!reason || reason.trim().length === 0) {
    actionError('INVALID_INPUT', 'reason es obligatorio para rechazar un gasto')
  }
  await transitionStatus(id, 'REJECTED', { rejectedReason: reason.trim() })
}

export async function markReimbursed(id: string): Promise<void> {
  await transitionStatus(id, 'REIMBURSED', { reimbursedAt: new Date() })
}

async function transitionStatus(
  id: string,
  next: ExpenseStatus,
  extra: Partial<{
    approvedById: string
    approvedAt: Date
    reimbursedAt: Date
    rejectedReason: string
  }> = {},
): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  const current = await prisma.expense.findUnique({
    where: { id },
    select: { id: true, status: true, amount: true, currency: true, amountUsd: true, projectId: true },
  })
  if (!current) actionError('EXPENSE_NOT_FOUND', `Gasto ${id} no existe`)

  if (!canTransitionExpense(current.status, next)) {
    actionError(
      'INVALID_STATUS_TRANSITION',
      `Transición ${current.status} → ${next} no permitida`,
    )
  }

  // Si pasa a SUBMITTED y no hay amountUsd, intentar rellenar.
  const data: Prisma.ExpenseUpdateInput = { status: next, ...extra }
  if (current.amountUsd === null) {
    const usd = await computeUsdAmount(Number(current.amount), current.currency)
    if (usd !== null) data.amountUsd = new Prisma.Decimal(usd)
  }

  await prisma.expense.update({ where: { id }, data })
  revalidateExpenseRoutes()
}

/**
 * Dispatcher de webhooks budget.* tras aprobar un gasto. Best-effort: no
 * bloquea la transición si falla. Calcula snapshots solo del proyecto del
 * gasto (no recorre toda la BD).
 */
async function maybeDispatchBudgetAlertsForExpense(expenseId: string): Promise<void> {
  try {
    const exp = await prisma.expense.findUnique({
      where: { id: expenseId },
      select: { projectId: true },
    })
    if (!exp) return

    const project = await prisma.project.findUnique({
      where: { id: exp.projectId },
      select: {
        id: true,
        name: true,
        budget: true,
        budgetCurrency: true,
        phases: { select: { id: true, name: true, budget: true, budgetCurrency: true } },
        sprints: { select: { id: true, name: true, budget: true, budgetCurrency: true } },
      },
    })
    if (!project) return

    // Sumar actualUsd por proyecto/phase/sprint.
    const expenses = await prisma.expense.findMany({
      where: {
        projectId: project.id,
        status: { in: ['APPROVED', 'REIMBURSED'] },
      },
      select: { amountUsd: true, taskId: true },
    })
    const taskScope = await prisma.task.findMany({
      where: { projectId: project.id },
      select: { id: true, phaseId: true, sprintId: true },
    })
    const taskMap = new Map(taskScope.map((t) => [t.id, t]))

    const actualByScope: Record<string, number> = {}
    actualByScope[project.id] = 0
    for (const e of expenses) {
      const usd = e.amountUsd === null ? 0 : Number(e.amountUsd)
      actualByScope[project.id] += usd
      if (e.taskId) {
        const t = taskMap.get(e.taskId)
        if (t?.phaseId) actualByScope[t.phaseId] = (actualByScope[t.phaseId] ?? 0) + usd
        if (t?.sprintId) actualByScope[t.sprintId] = (actualByScope[t.sprintId] ?? 0) + usd
      }
    }

    const scopes = [
      {
        scopeId: project.id,
        scopeType: 'project' as const,
        budget: project.budget === null ? null : Number(project.budget),
        currency: project.budgetCurrency,
      },
      ...project.phases.map((p) => ({
        scopeId: p.id,
        scopeType: 'phase' as const,
        budget: p.budget === null ? null : Number(p.budget),
        currency: p.budgetCurrency,
      })),
      ...project.sprints.map((s) => ({
        scopeId: s.id,
        scopeType: 'sprint' as const,
        budget: s.budget === null ? null : Number(s.budget),
        currency: s.budgetCurrency,
      })),
    ]
    const names: Record<string, string> = { [project.id]: project.name }
    for (const p of project.phases) names[p.id] = p.name
    for (const s of project.sprints) names[s.id] = s.name

    // Convertir budgets a USD con rates en memoria.
    const rates = await loadLatestRates()
    const lookup = lookupFromRows(rates)
    const budgetUsdByScope: Record<string, number> = {}
    for (const sc of scopes) {
      if (sc.budget === null) continue
      if ((sc.currency ?? 'USD').toUpperCase() === 'USD') {
        budgetUsdByScope[sc.scopeId] = sc.budget
        continue
      }
      const usd = await toUsd(sc.budget, sc.currency ?? 'USD', lookup)
      if (usd !== null) budgetUsdByScope[sc.scopeId] = usd
    }

    const snapshots = buildBudgetSnapshots(scopes, actualByScope, budgetUsdByScope)
    const events = detectBudgetAlerts({ snapshots, names })

    if (events.length === 0) return

    await dispatchBudgetAlerts(events, async (eventType, payload) => {
      // Cast: el dispatcher tiene tipo cerrado pero filtra por string en runtime.
      // Eventos `budget.*` se reciben por webhooks suscritos al wildcard `*`.
      await dispatchWebhookEvent(eventType as WebhookEventType, payload)
    })
  } catch (err) {
    // Best-effort: log y continúa.
    console.warn(
      `[expenses] dispatch de alertas falló para expense ${expenseId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

// ─────────────────────── Queries ───────────────────────

export interface SerializedExpense {
  id: string
  projectId: string
  projectName: string
  taskId: string | null
  taskTitle: string | null
  submittedById: string
  submittedByName: string
  description: string
  amount: number
  currency: string
  amountUsd: number | null
  receiptUrl: string | null
  status: ExpenseStatus
  approvedById: string | null
  approvedAt: string | null
  reimbursedAt: string | null
  rejectedReason: string | null
  incurredAt: string
  createdAt: string
}

export async function listExpenses(filters?: {
  projectId?: string
  status?: ExpenseStatus
  submittedById?: string
}): Promise<SerializedExpense[]> {
  const where: Prisma.ExpenseWhereInput = {}
  if (filters?.projectId) where.projectId = filters.projectId
  if (filters?.status) where.status = filters.status
  if (filters?.submittedById) where.submittedById = filters.submittedById

  const rows = await prisma.expense.findMany({
    where,
    orderBy: [{ incurredAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      project: { select: { name: true } },
      task: { select: { title: true } },
      submittedBy: { select: { name: true } },
    },
    take: 500,
  })

  return rows.map((e) => ({
    id: e.id,
    projectId: e.projectId,
    projectName: e.project.name,
    taskId: e.taskId,
    taskTitle: e.task?.title ?? null,
    submittedById: e.submittedById,
    submittedByName: e.submittedBy.name,
    description: e.description,
    amount: Number(e.amount),
    currency: e.currency,
    amountUsd: e.amountUsd === null ? null : Number(e.amountUsd),
    receiptUrl: e.receiptUrl,
    status: e.status,
    approvedById: e.approvedById,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    reimbursedAt: e.reimbursedAt?.toISOString() ?? null,
    rejectedReason: e.rejectedReason,
    incurredAt: e.incurredAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
  }))
}
