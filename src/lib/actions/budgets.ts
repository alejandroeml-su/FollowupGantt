'use server'

/**
 * Ola P8 · Equipo P8-3 — Server actions de presupuestos por
 * project / phase / sprint.
 *
 * Setean / actualizan los campos `budget` y `budgetCurrency` añadidos en la
 * migración `20260505_cost_management`. Calculan también la vista
 * Budget vs Actual por scope (consulta agregada que alimenta el
 * `BudgetVsActualChart`) y el forecast EAC/VAC.
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle`.
 *   - zod por entrada; revalidatePath('/expenses', '/dashboards', '/projects')
 *     tras cualquier mutación.
 *   - El forecast llama a `forecastEac` (función pura) — esta capa solo
 *     orquesta queries.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { isValidIsoCurrency } from '@/lib/cost/expense-types'
import { forecastEac, type ForecastResult } from '@/lib/cost/forecast-eac'
import { lookupFromRows, toUsd, type CurrencyRateRow } from '@/lib/cost/currency-convert'

// ─────────────────────── Errores tipados ───────────────────────

export type BudgetsErrorCode =
  | 'INVALID_INPUT'
  | 'PROJECT_NOT_FOUND'
  | 'PHASE_NOT_FOUND'
  | 'SPRINT_NOT_FOUND'
  | 'INVALID_CURRENCY'

function actionError(code: BudgetsErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

const budgetSchema = z.object({
  budget: z.number().finite().positive('budget debe ser > 0').nullable(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidIsoCurrency, 'Moneda inválida (ISO 4217)')
    .nullable(),
})

export type SetBudgetInput = z.input<typeof budgetSchema>

function revalidateRoutes(): void {
  revalidatePath('/expenses')
  revalidatePath('/dashboards')
  revalidatePath('/projects')
}

// ─────────────────────── Setters ───────────────────────

export async function setProjectBudget(
  projectId: string,
  input: SetBudgetInput,
): Promise<void> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId es obligatorio')
  const parsed = budgetSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })
  if (!project) actionError('PROJECT_NOT_FOUND', `Proyecto ${projectId} no existe`)

  await prisma.project.update({
    where: { id: projectId },
    data: {
      budget: parsed.data.budget === null ? null : new Prisma.Decimal(parsed.data.budget),
      budgetCurrency: parsed.data.currency,
    },
  })

  revalidateRoutes()
}

export async function setPhaseBudget(
  phaseId: string,
  input: SetBudgetInput,
): Promise<void> {
  if (!phaseId) actionError('INVALID_INPUT', 'phaseId es obligatorio')
  const parsed = budgetSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const phase = await prisma.phase.findUnique({
    where: { id: phaseId },
    select: { id: true },
  })
  if (!phase) actionError('PHASE_NOT_FOUND', `Fase ${phaseId} no existe`)

  await prisma.phase.update({
    where: { id: phaseId },
    data: {
      budget: parsed.data.budget === null ? null : new Prisma.Decimal(parsed.data.budget),
      budgetCurrency: parsed.data.currency,
    },
  })

  revalidateRoutes()
}

export async function setSprintBudget(
  sprintId: string,
  input: SetBudgetInput,
): Promise<void> {
  if (!sprintId) actionError('INVALID_INPUT', 'sprintId es obligatorio')
  const parsed = budgetSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { id: true },
  })
  if (!sprint) actionError('SPRINT_NOT_FOUND', `Sprint ${sprintId} no existe`)

  await prisma.sprint.update({
    where: { id: sprintId },
    data: {
      budget: parsed.data.budget === null ? null : new Prisma.Decimal(parsed.data.budget),
      budgetCurrency: parsed.data.currency,
    },
  })

  revalidateRoutes()
}

// ─────────────────────── Queries: Budget vs Actual ───────────────────────

export interface BudgetVsActualRow {
  scopeId: string
  scopeType: 'project' | 'phase' | 'sprint'
  scopeName: string
  budget: number | null
  budgetCurrency: string | null
  budgetUsd: number | null
  actualUsd: number
  utilization: number | null
}

export async function getBudgetVsActualForProject(
  projectId: string,
): Promise<BudgetVsActualRow[]> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId es obligatorio')

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      budget: true,
      budgetCurrency: true,
      phases: { select: { id: true, name: true, budget: true, budgetCurrency: true } },
      sprints: { select: { id: true, name: true, budget: true, budgetCurrency: true } },
    },
  })
  if (!project) actionError('PROJECT_NOT_FOUND', `Proyecto ${projectId} no existe`)

  const expenses = await prisma.expense.findMany({
    where: {
      projectId,
      status: { in: ['APPROVED', 'REIMBURSED'] },
    },
    select: { amountUsd: true, taskId: true },
  })
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { id: true, phaseId: true, sprintId: true },
  })
  const taskMap = new Map(tasks.map((t) => [t.id, t]))

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

  const rates = await loadLatestRates()
  const lookup = lookupFromRows(rates)

  const out: BudgetVsActualRow[] = []
  out.push(
    await toRow({
      scopeId: project.id,
      scopeType: 'project',
      scopeName: project.name,
      budget: project.budget,
      currency: project.budgetCurrency,
      actualUsd: actualByScope[project.id] ?? 0,
      lookup,
    }),
  )
  for (const ph of project.phases) {
    out.push(
      await toRow({
        scopeId: ph.id,
        scopeType: 'phase',
        scopeName: ph.name,
        budget: ph.budget,
        currency: ph.budgetCurrency,
        actualUsd: actualByScope[ph.id] ?? 0,
        lookup,
      }),
    )
  }
  for (const sp of project.sprints) {
    out.push(
      await toRow({
        scopeId: sp.id,
        scopeType: 'sprint',
        scopeName: sp.name,
        budget: sp.budget,
        currency: sp.budgetCurrency,
        actualUsd: actualByScope[sp.id] ?? 0,
        lookup,
      }),
    )
  }
  return out
}

async function toRow(args: {
  scopeId: string
  scopeType: 'project' | 'phase' | 'sprint'
  scopeName: string
  budget: Prisma.Decimal | null
  currency: string | null
  actualUsd: number
  lookup: ReturnType<typeof lookupFromRows>
}): Promise<BudgetVsActualRow> {
  const budgetNum = args.budget === null ? null : Number(args.budget)
  let budgetUsd: number | null = null
  if (budgetNum !== null) {
    if ((args.currency ?? 'USD').toUpperCase() === 'USD') {
      budgetUsd = budgetNum
    } else {
      budgetUsd = await toUsd(budgetNum, args.currency ?? 'USD', args.lookup)
    }
  }
  const utilization =
    budgetUsd && budgetUsd > 0 ? Math.round((args.actualUsd / budgetUsd) * 10000) / 10000 : null
  return {
    scopeId: args.scopeId,
    scopeType: args.scopeType,
    scopeName: args.scopeName,
    budget: budgetNum,
    budgetCurrency: args.currency,
    budgetUsd,
    actualUsd: Math.round(args.actualUsd * 100) / 100,
    utilization,
  }
}

// ─────────────────────── Forecast EAC ───────────────────────

export interface ProjectForecastResult extends ForecastResult {
  projectId: string
  projectName: string
  budgetUsd: number | null
  budgetCurrency: string | null
}

export async function getProjectForecast(
  projectId: string,
): Promise<ProjectForecastResult> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId es obligatorio')

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      budget: true,
      budgetCurrency: true,
      tasks: {
        select: { id: true, plannedValue: true, progress: true },
      },
      sprints: {
        where: { endedAt: { not: null } },
        select: {
          id: true,
          velocityActual: true,
          capacity: true,
          endedAt: true,
        },
      },
    },
  })
  if (!project) actionError('PROJECT_NOT_FOUND', `Proyecto ${projectId} no existe`)

  const expenses = await prisma.expense.findMany({
    where: { projectId, status: { in: ['APPROVED', 'REIMBURSED'] } },
    select: { amountUsd: true },
  })
  const actualUsd = expenses.reduce(
    (acc, e) => acc + (e.amountUsd === null ? 0 : Number(e.amountUsd)),
    0,
  )

  let bacOverride: number | null = null
  if (project.budget !== null) {
    const num = Number(project.budget)
    if ((project.budgetCurrency ?? 'USD').toUpperCase() === 'USD') {
      bacOverride = num
    } else {
      const rates = await loadLatestRates()
      const lookup = lookupFromRows(rates)
      bacOverride = (await toUsd(num, project.budgetCurrency ?? 'USD', lookup)) ?? null
    }
  }

  const result = forecastEac({
    tasks: project.tasks.map((t) => ({
      id: t.id,
      plannedValue: t.plannedValue,
      progress: t.progress,
    })),
    actualCostUsd: actualUsd,
    sprints: project.sprints.map((s) => ({
      sprintId: s.id,
      velocityActual: s.velocityActual,
      capacity: s.capacity,
      endedAt: s.endedAt,
    })),
    bacOverride,
  })

  return {
    ...result,
    projectId: project.id,
    projectName: project.name,
    budgetUsd: bacOverride,
    budgetCurrency: project.budgetCurrency,
  }
}

// ─────────────────────── Helpers ───────────────────────

async function loadLatestRates(): Promise<CurrencyRateRow[]> {
  const rows = await prisma.currencyRate.findMany({
    where: { base: 'USD' },
    orderBy: { fetchedAt: 'desc' },
    take: 200,
  })
  return rows.map((r) => ({
    base: r.base,
    quote: r.quote,
    rate:
      typeof r.rate === 'object' && r.rate !== null && 'toNumber' in r.rate
        ? (r.rate as Prisma.Decimal).toNumber()
        : Number(r.rate),
    fetchedAt: r.fetchedAt,
  }))
}
