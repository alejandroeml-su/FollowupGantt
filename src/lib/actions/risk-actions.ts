'use server'

/**
 * Wave R-360 — Server actions para gestionar el plan de acciones
 * correctivas (RiskAction) de un Risk + promoción de insights
 * heurísticos (TaskInsight DELAY_RISK) al Risk Register formal.
 *
 * Convenciones del repo:
 *   - `'use server'` purity: solo exports async (helpers sync van en
 *     archivos puros).
 *   - Errores tipados `[CODE] mensaje`.
 *   - Validación zod por entrada.
 *   - revalidatePath de las vistas afectadas tras mutación.
 *
 * Decisiones (D-R360-1 .. D-R360-3):
 *   D-R360-1 · La promoción de un TaskInsight a Risk usa `sourceRef =
 *              taskInsightId` para idempotencia. Si ya existe un Risk
 *              con esa pareja (source=HEURISTIC, sourceRef=insightId)
 *              devolvemos el existente (no duplicamos).
 *   D-R360-2 · Probability/impact derivados del score+level del insight:
 *              level=high  → probability=4, impact=4 (score 16 = HIGH)
 *              level=medium→ probability=3, impact=3 (score  9 = MEDIUM)
 *              level=low   → probability=2, impact=2 (score  4 = LOW)
 *              El score numérico fino del insight modula ±1 dentro de
 *              esos bandos (ver `derivePmiLevels`).
 *   D-R360-3 · Auto-set de `doneAt` al transicionar RiskAction a DONE,
 *              y reset a NULL si se reabre.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma, type RiskActionStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { derivePmiLevels } from '@/lib/risks/heuristic-promotion'

// ───────────────────────── Errores tipados ─────────────────────────

export type RiskActionsErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INSIGHT_NOT_FOUND'
  | 'ALREADY_PROMOTED'
  | 'OWNER_NOT_FOUND'

function actionError(code: RiskActionsErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const RISK_ACTION_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const satisfies readonly RiskActionStatus[]

const createRiskActionSchema = z.object({
  riskId: z.string().min(1),
  description: z.string().trim().min(3, 'mínimo 3 caracteres').max(500),
  ownerId: z.string().min(1).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  status: z.enum(RISK_ACTION_STATUSES).optional(),
})

export type CreateRiskActionInput = z.input<typeof createRiskActionSchema>

const updateRiskActionSchema = z.object({
  id: z.string().min(1),
  description: z.string().trim().min(3).max(500).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  status: z.enum(RISK_ACTION_STATUSES).optional(),
})

export type UpdateRiskActionInput = z.input<typeof updateRiskActionSchema>

// ───────────────────────── Helpers ─────────────────────────

async function ensureRiskExists(riskId: string): Promise<{ projectId: string }> {
  const r = await prisma.risk.findUnique({
    where: { id: riskId },
    select: { id: true, projectId: true },
  })
  if (!r) actionError('NOT_FOUND', `Risk ${riskId} no existe`)
  return { projectId: r.projectId }
}

async function ensureUserExists(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })
  if (!u) actionError('OWNER_NOT_FOUND', `Usuario ${userId} no existe`)
}

function revalidateRiskRoutes(projectId: string): void {
  revalidatePath('/risks')
  revalidatePath('/insights')
  revalidatePath('/portfolio/risks')
  revalidatePath(`/projects/${projectId}/risks`)
}

// ───────────────────────── CRUD RiskAction ─────────────────────────

export async function createRiskAction(
  input: CreateRiskActionInput,
): Promise<{ id: string }> {
  const parsed = createRiskActionSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data
  const { projectId } = await ensureRiskExists(data.riskId)
  if (data.ownerId) await ensureUserExists(data.ownerId)

  const created = await prisma.riskAction.create({
    data: {
      riskId: data.riskId,
      description: data.description,
      ownerId: data.ownerId ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      status: data.status ?? 'PENDING',
    },
    select: { id: true },
  })

  await recordAuditEventSafe({
    action: 'risk_action.created',
    entityType: 'risk_action',
    entityId: created.id,
    after: { riskId: data.riskId, description: data.description.slice(0, 100) },
  })

  revalidateRiskRoutes(projectId)
  return created
}

export async function updateRiskAction(
  input: UpdateRiskActionInput,
): Promise<void> {
  const parsed = updateRiskActionSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const p = parsed.data

  const current = await prisma.riskAction.findUnique({
    where: { id: p.id },
    select: {
      id: true,
      status: true,
      doneAt: true,
      risk: { select: { projectId: true } },
    },
  })
  if (!current) actionError('NOT_FOUND', `RiskAction ${p.id} no existe`)
  if (p.ownerId) await ensureUserExists(p.ownerId)

  const data: Prisma.RiskActionUpdateInput = {}
  if (p.description !== undefined) data.description = p.description
  if (p.dueDate !== undefined) {
    data.dueDate = p.dueDate ? new Date(p.dueDate) : null
  }
  if (p.ownerId !== undefined) {
    data.owner = p.ownerId
      ? { connect: { id: p.ownerId } }
      : { disconnect: true }
  }
  if (p.status !== undefined) {
    data.status = p.status
    // D-R360-3: auto-set / reset de doneAt según transición.
    if (p.status === 'DONE' && !current.doneAt) {
      data.doneAt = new Date()
    } else if (p.status !== 'DONE' && current.doneAt) {
      data.doneAt = null
    }
  }

  await prisma.riskAction.update({ where: { id: p.id }, data })

  await recordAuditEventSafe({
    action: 'risk_action.updated',
    entityType: 'risk_action',
    entityId: p.id,
    before: { status: current.status },
    after: p,
  })

  revalidateRiskRoutes(current.risk.projectId)
}

export async function deleteRiskAction(input: { id: string }): Promise<void> {
  if (!input.id) actionError('INVALID_INPUT', 'id requerido')

  const existing = await prisma.riskAction.findUnique({
    where: { id: input.id },
    select: { risk: { select: { projectId: true } } },
  })
  if (!existing) actionError('NOT_FOUND', `RiskAction ${input.id} no existe`)

  await prisma.riskAction.delete({ where: { id: input.id } })

  await recordAuditEventSafe({
    action: 'risk_action.deleted',
    entityType: 'risk_action',
    entityId: input.id,
  })

  revalidateRiskRoutes(existing.risk.projectId)
}

// ─────────────────────── Promoción heurística ───────────────────────

const promoteSchema = z.object({
  taskInsightId: z.string().min(1),
})

export type PromoteHeuristicInput = z.input<typeof promoteSchema>

/**
 * Promueve un TaskInsight kind=DELAY_RISK a un Risk formal en el Risk
 * Register del proyecto. Idempotente: si ya existe un Risk con
 * `source=HEURISTIC` y `sourceRef=insightId`, devuelve el existente.
 *
 * Tras promover, marca el insight como dismissed para que no aparezca
 * de nuevo en `/insights`. El Risk queda con `source=HEURISTIC` y `taskId`
 * apuntando a la task original.
 */
export async function promoteHeuristicInsightToRisk(
  input: PromoteHeuristicInput,
): Promise<{ id: string; alreadyPromoted: boolean }> {
  const parsed = promoteSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', 'taskInsightId requerido')
  }
  const { taskInsightId } = parsed.data

  // Dedupe: ¿ya promovido?
  const existing = await prisma.risk.findFirst({
    where: { source: 'HEURISTIC', sourceRef: taskInsightId },
    select: { id: true },
  })
  if (existing) return { id: existing.id, alreadyPromoted: true }

  const insight = await prisma.taskInsight.findUnique({
    where: { id: taskInsightId },
    select: {
      id: true,
      kind: true,
      score: true,
      payload: true,
      task: {
        select: { id: true, title: true, projectId: true },
      },
    },
  })
  if (!insight) actionError('INSIGHT_NOT_FOUND', `Insight ${taskInsightId} no existe`)
  if (insight.kind !== 'DELAY_RISK') {
    actionError('INVALID_INPUT', 'Solo insights kind=DELAY_RISK pueden promoverse a Risk')
  }

  const payload = (insight.payload ?? {}) as {
    level?: 'high' | 'medium' | 'low'
    factors?: string[]
  }
  const { probability, impact } = derivePmiLevels(payload.level, insight.score)
  const factors = Array.isArray(payload.factors) ? payload.factors : []

  const description =
    factors.length > 0
      ? `Riesgo de retraso heurístico. Factores detectados: ${factors.join('; ')}.`
      : 'Riesgo de retraso heurístico promovido desde /insights.'

  const created = await prisma.risk.create({
    data: {
      projectId: insight.task.projectId,
      taskId: insight.task.id,
      title: `Retraso · ${insight.task.title}`.slice(0, 200),
      description: description.slice(0, 2000),
      probability,
      impact,
      status: 'OPEN',
      source: 'HEURISTIC',
      sourceRef: insight.id,
    },
    select: { id: true },
  })

  // Dismiss el insight para que no se vuelva a sugerir.
  await prisma.taskInsight.update({
    where: { id: insight.id },
    data: { dismissedAt: new Date() },
  })

  await recordAuditEventSafe({
    action: 'risk.promoted_from_insight',
    entityType: 'risk',
    entityId: created.id,
    after: {
      projectId: insight.task.projectId,
      taskId: insight.task.id,
      source: 'HEURISTIC',
      sourceRef: insight.id,
    },
  })

  revalidateRiskRoutes(insight.task.projectId)
  return { id: created.id, alreadyPromoted: false }
}

/**
 * Promueve TODOS los insights DELAY_RISK abiertos de un proyecto a Risks.
 * Útil como bulk action desde la pantalla de gestión de riesgos.
 */
export async function promoteAllHeuristicInsightsForProject(input: {
  projectId: string
}): Promise<{ created: number; skipped: number }> {
  if (!input.projectId) actionError('INVALID_INPUT', 'projectId requerido')

  const insights = await prisma.taskInsight.findMany({
    where: {
      kind: 'DELAY_RISK',
      dismissedAt: null,
      task: { projectId: input.projectId },
    },
    select: { id: true },
  })

  let created = 0
  let skipped = 0
  for (const i of insights) {
    const r = await promoteHeuristicInsightToRisk({ taskInsightId: i.id })
    if (r.alreadyPromoted) skipped += 1
    else created += 1
  }
  return { created, skipped }
}

// ───────────────────────── Queries ─────────────────────────

export async function listRiskActionsForRisk(riskId: string) {
  if (!riskId) return []
  return prisma.riskAction.findMany({
    where: { riskId },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    include: { owner: { select: { id: true, name: true } } },
  })
}
