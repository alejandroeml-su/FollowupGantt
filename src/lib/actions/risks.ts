'use server'

/**
 * Wave P8 · Equipo P8-2 — Server actions del Risk Register + Monte Carlo.
 *
 * Implementa CRUD de `Risk` y la query agregada `getRisksForProject` que
 * sirve a `/risks/page.tsx`. La simulación Monte Carlo se delega al módulo
 * puro `@/lib/risks/monte-carlo` reusando el adapter CPM existente
 * (`@/lib/scheduling/prismaAdapter`).
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle` (`RISK_NOT_FOUND`, `INVALID_INPUT`,
 *     `OWNER_NOT_FOUND`, `PROJECT_NOT_FOUND`).
 *   - Validación zod por entrada.
 *   - `revalidatePath('/risks')` tras cualquier mutación.
 *
 * Decisiones autónomas (D-RISK-1 .. D-RISK-3 documentadas en schema y
 * monte-carlo.ts):
 *   D-RISK-1 · `score` y `tier` se calculan en cada query — NO se
 *             persisten para evitar drift cuando se ajustan probability/
 *             impact directamente vía SQL.
 *   D-RISK-2 · El delay de un risk afecta al proyecto completo en MVP.
 *   D-RISK-3 · Auto-set de `closedAt` al transicionar a CLOSED, y reset
 *             a NULL si se reabre desde CLOSED.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma, type RiskStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { evaluateRisk, tierFromScore } from '@/lib/risks/risk-score'
// Wave P17-B (API v2 / Webhooks v2) — dispatch fire-and-forget.
import { dispatchEvent as dispatchV2Event } from '@/lib/webhooks-out/dispatcher'
// Wave P18-C — Automation rule engine triggers.
import { dispatchEvent as dispatchAutomationEvent } from '@/lib/actions/automation'
import {
  simulateProjectDuration,
  type MonteCarloResult,
  type MonteCarloRiskInput,
} from '@/lib/risks/monte-carlo'
import { loadCpmInputForProject } from '@/lib/scheduling/prismaAdapter'
import type {
  ImpactLevel,
  ProbabilityLevel,
  SerializedRisk,
} from '@/lib/risks/types'

// ───────────────────────── Errores tipados ─────────────────────────

export type RisksErrorCode =
  | 'INVALID_INPUT'
  | 'RISK_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'OWNER_NOT_FOUND'

function actionError(code: RisksErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const RISK_STATUS_VALUES = [
  'OPEN',
  'MITIGATING',
  'ACCEPTED',
  'CLOSED',
] as const satisfies readonly RiskStatus[]

const levelSchema = z
  .number()
  .int()
  .min(1, 'debe ser ≥ 1')
  .max(5, 'debe ser ≤ 5')

const riskCreateSchema = z.object({
  projectId: z.string().min(1, 'projectId es obligatorio'),
  title: z.string().trim().min(1, 'El título es obligatorio').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  probability: levelSchema,
  impact: levelSchema,
  status: z.enum(RISK_STATUS_VALUES).optional(),
  ownerId: z.string().min(1).optional().nullable(),
  mitigation: z.string().trim().max(2000).optional().nullable(),
  triggerDelayDays: z.number().int().min(0).max(3650).optional().nullable(),
  /** Vínculo opcional con la tarea originadora (Wave P14c). Cuando se
   * crea un riesgo desde el drawer de una tarea, se persiste para
   * habilitar drill-down y agrupación por tarea. */
  taskId: z.string().min(1).optional().nullable(),
})

export type CreateRiskInput = z.input<typeof riskCreateSchema>

const riskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  probability: levelSchema.optional(),
  impact: levelSchema.optional(),
  status: z.enum(RISK_STATUS_VALUES).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  mitigation: z.string().trim().max(2000).nullable().optional(),
  triggerDelayDays: z.number().int().min(0).max(3650).nullable().optional(),
})

export type UpdateRiskInput = z.input<typeof riskUpdateSchema>

// ───────────────────────── Helpers ─────────────────────────

async function ensureProjectExists(projectId: string): Promise<void> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })
  if (!p) actionError('PROJECT_NOT_FOUND', `Proyecto ${projectId} no existe`)
}

async function ensureUserExists(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })
  if (!u) actionError('OWNER_NOT_FOUND', `Usuario ${userId} no existe`)
}

function revalidateRisksRoutes(): void {
  revalidatePath('/risks')
}

type RiskRow = {
  id: string
  projectId: string
  title: string
  description: string | null
  probability: number
  impact: number
  status: RiskStatus
  ownerId: string | null
  mitigation: string | null
  triggerDelayDays: number | null
  detectedAt: Date
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
  project: { name: string } | null
  owner: { name: string } | null
}

function serializeRisk(row: RiskRow): SerializedRisk {
  const probability = row.probability as ProbabilityLevel
  const impact = row.impact as ImpactLevel
  const { score, tier } = evaluateRisk(probability, impact)
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    title: row.title,
    description: row.description,
    probability,
    impact,
    score,
    tier,
    status: row.status,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    mitigation: row.mitigation,
    triggerDelayDays: row.triggerDelayDays,
    detectedAt: row.detectedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ───────────────────────── CRUD ─────────────────────────

export async function createRisk(
  input: CreateRiskInput,
): Promise<{ id: string }> {
  const parsed = riskCreateSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  await ensureProjectExists(data.projectId)
  if (data.ownerId) await ensureUserExists(data.ownerId)

  const created = await prisma.risk.create({
    data: {
      projectId: data.projectId,
      title: data.title,
      description: data.description ?? null,
      probability: data.probability,
      impact: data.impact,
      status: data.status ?? 'OPEN',
      ownerId: data.ownerId ?? null,
      mitigation: data.mitigation ?? null,
      triggerDelayDays: data.triggerDelayDays ?? null,
      taskId: data.taskId ?? null,
    },
    select: { id: true },
  })

  revalidateRisksRoutes()
  return created
}

export async function updateRisk(
  id: string,
  patch: UpdateRiskInput,
): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  const parsed = riskUpdateSchema.safeParse(patch)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const p = parsed.data

  const current = await prisma.risk.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      closedAt: true,
      probability: true,
      impact: true,
      title: true,
      projectId: true,
      // Wave P17-B — necesitamos el workspaceId del proyecto para emitir
      // webhook v2 si la severidad cruza a HIGH/CRITICAL.
      project: { select: { workspaceId: true } },
    },
  })
  if (!current) actionError('RISK_NOT_FOUND', `Riesgo ${id} no existe`)

  if (p.ownerId) await ensureUserExists(p.ownerId)

  const data: Prisma.RiskUpdateInput = {}
  if (p.title !== undefined) data.title = p.title
  if (p.description !== undefined) data.description = p.description
  if (p.probability !== undefined) data.probability = p.probability
  if (p.impact !== undefined) data.impact = p.impact
  if (p.mitigation !== undefined) data.mitigation = p.mitigation
  if (p.triggerDelayDays !== undefined) {
    data.triggerDelayDays = p.triggerDelayDays
  }
  if (p.ownerId !== undefined) {
    data.owner = p.ownerId
      ? { connect: { id: p.ownerId } }
      : { disconnect: true }
  }
  if (p.status !== undefined) {
    data.status = p.status
    // D-RISK-3: gestionar `closedAt` automáticamente.
    if (p.status === 'CLOSED' && !current.closedAt) {
      data.closedAt = new Date()
    } else if (p.status !== 'CLOSED' && current.closedAt) {
      data.closedAt = null
    }
  }

  await prisma.risk.update({ where: { id }, data })

  // Wave P17-B — emitir `risk.high_severity` solo si el tier ahora es
  // HIGH o CRITICAL Y el tier anterior era LOW o MEDIUM (transición).
  // Esto evita spam si un risk ya HIGH se actualiza con cambios menores.
  try {
    const newProbability =
      p.probability !== undefined ? p.probability : current.probability
    const newImpact = p.impact !== undefined ? p.impact : current.impact
    const previousTier = tierFromScore(current.probability * current.impact)
    const newTier = tierFromScore(newProbability * newImpact)
    const wasHigh = previousTier === 'HIGH' || previousTier === 'CRITICAL'
    const isHigh = newTier === 'HIGH' || newTier === 'CRITICAL'
    if (!wasHigh && isHigh && current.project?.workspaceId) {
      void dispatchV2Event({
        workspaceId: current.project.workspaceId,
        event: 'risk.high_severity',
        payload: {
          id: current.id,
          title: current.title,
          projectId: current.projectId,
          probability: newProbability,
          impact: newImpact,
          severity: newTier,
        },
      })
    }
    // Wave P18-C — paralelo · trigger automation rules en la misma transición.
    if (!wasHigh && isHigh) {
      void dispatchAutomationEvent('risk.high_severity', {
        triggeredBy: `risk:${current.id}`,
        data: {
          riskId: current.id,
          title: current.title,
          projectId: current.projectId,
          probability: newProbability,
          impact: newImpact,
          severity: newTier,
        },
      })
    }
  } catch {
    // No bloqueamos la operación si el dispatch falla.
  }

  revalidateRisksRoutes()
}

export async function deleteRisk(id: string): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  try {
    await prisma.risk.delete({ where: { id } })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2025'
    ) {
      actionError('RISK_NOT_FOUND', `Riesgo ${id} no existe`)
    }
    throw err
  }
  revalidateRisksRoutes()
}

// ───────────────────────── Queries ─────────────────────────

export async function getRisksForProject(
  projectId: string | null,
): Promise<SerializedRisk[]> {
  const where: Prisma.RiskWhereInput = projectId ? { projectId } : {}
  const rows = await prisma.risk.findMany({
    where,
    orderBy: [{ probability: 'desc' }, { impact: 'desc' }, { createdAt: 'desc' }],
    include: {
      project: { select: { name: true } },
      owner: { select: { name: true } },
    },
  })
  return rows.map(serializeRisk)
}

/**
 * P17-A · Variante paginada (cursor-based) de `getRisksForProject`.
 *
 * Para listas largas (Risk Register cross-project con cientos de
 * riesgos) la versión sin paginar carga todo en una sola respuesta y
 * satura tanto Postgres como la red. Aquí el cursor es el `id` del
 * último riesgo visto, ordenando por (probability DESC, impact DESC,
 * createdAt DESC, id DESC).
 *
 * Devuelve `{ rows, nextCursor }`. Si `nextCursor` es null, no hay
 * más páginas. La UI mantiene el cursor en estado y llama de nuevo
 * con cursorId para cargar la siguiente.
 */
export async function getRisksForProjectPaginated(input: {
  projectId?: string | null
  status?: RiskStatus | null
  limit?: number
  cursorId?: string | null
}): Promise<{ rows: SerializedRisk[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(200, input.limit ?? 50))
  const where: Prisma.RiskWhereInput = {}
  if (input.projectId) where.projectId = input.projectId
  if (input.status) where.status = input.status

  const rows = await prisma.risk.findMany({
    where,
    orderBy: [
      { probability: 'desc' },
      { impact: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit + 1,
    ...(input.cursorId
      ? { cursor: { id: input.cursorId }, skip: 1 }
      : {}),
    include: {
      project: { select: { name: true } },
      owner: { select: { name: true } },
    },
  })

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  return {
    rows: slice.map(serializeRisk),
    nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
  }
}

/**
 * Riesgos vinculados a una tarea (vía `Risk.taskId`). Pensado para la
 * sección de Riesgos del drawer de tarea (Wave 2026-05-13). Orden por
 * severidad descendente (probability × impact) y luego por createdAt asc.
 */
export async function getRisksForTask(taskId: string): Promise<SerializedRisk[]> {
  if (!taskId) return []
  const rows = await prisma.risk.findMany({
    where: { taskId },
    orderBy: [
      { probability: 'desc' },
      { impact: 'desc' },
      { createdAt: 'asc' },
    ],
    include: {
      project: { select: { name: true } },
      owner: { select: { name: true } },
    },
  })
  return rows.map(serializeRisk)
}

export async function getRiskById(id: string): Promise<SerializedRisk | null> {
  const row = await prisma.risk.findUnique({
    where: { id },
    include: {
      project: { select: { name: true } },
      owner: { select: { name: true } },
    },
  })
  return row ? serializeRisk(row) : null
}

// ───────────────────────── Monte Carlo ─────────────────────────

export interface MonteCarloRunInput {
  projectId: string
  iterations?: number
  seed?: number
}

/**
 * Corre la simulación Monte Carlo sobre las tasks de un proyecto +
 * sus risks abiertos (status ∈ {OPEN, MITIGATING}). Risks ACCEPTED o
 * CLOSED se excluyen porque no aportan incertidumbre activa.
 *
 * Retorna las muestras + percentiles para `MonteCarloChart`.
 */
export async function runMonteCarloForProject(
  input: MonteCarloRunInput,
): Promise<MonteCarloResult> {
  if (!input.projectId) actionError('INVALID_INPUT', 'projectId es obligatorio')
  await ensureProjectExists(input.projectId)

  const [cpmInput, riskRows] = await Promise.all([
    loadCpmInputForProject(input.projectId),
    prisma.risk.findMany({
      where: {
        projectId: input.projectId,
        status: { in: ['OPEN', 'MITIGATING'] },
      },
      select: {
        id: true,
        probability: true,
        triggerDelayDays: true,
      },
    }),
  ])

  const risks: MonteCarloRiskInput[] = riskRows
    .filter((r) => r.triggerDelayDays !== null && r.triggerDelayDays > 0)
    .map((r) => ({
      id: r.id,
      probability: r.probability,
      triggerDelayDays: r.triggerDelayDays as number,
    }))

  return simulateProjectDuration({
    cpmInput,
    risks,
    options: {
      iterations: input.iterations,
      seed: input.seed,
    },
  })
}
