'use server'

/**
 * Wave P19-D · Brain Strategist Persistence — Server actions.
 *
 * Las olas P19-A/B/C entregaron el Strategist en modo "ephemeral":
 * cada visita regenera la cross-project view. Esta capa agrega
 * persistencia para que stakeholders puedan ver evolución temporal
 * y comparar reportes mes-a-mes.
 *
 * Cinco acciones:
 *   - persistStrategistReport(report, workspaceId?) — explota un
 *     `StrategistReport` en N rows BrainStrategistInsight con dedupe
 *     por payload signature (mismo insight NEW/ACK del último día
 *     no se vuelve a crear).
 *   - listStrategistInsights({...filters}) — paginación cursor-based.
 *   - acknowledgeInsight({id, userId}) — NEW → ACKNOWLEDGED.
 *   - resolveInsight({id}) — ACKNOWLEDGED → RESOLVED.
 *   - dismissInsight({id}) — * → DISMISSED.
 *
 * Errores tipados con prefijo `[CODE]` para que el cliente pueda
 * mapearlos a mensajes i18n estables.
 */

import { z } from 'zod'
import { Prisma, type BrainStrategistInsight } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import type { StrategistReport } from './actions'

// ─── Constantes & tipos ─────────────────────────────────────────────

const STATUS = ['NEW', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const
export type StrategistInsightStatus = (typeof STATUS)[number]

const KIND = [
  'RESOURCE_CONTENTION',
  'DEPENDENCY_CONFLICT',
  'REUSABLE_LESSON',
  'PREDICTIVE_SCENARIO',
  'BALANCE_SUGGESTION',
] as const
export type StrategistInsightKindKey = (typeof KIND)[number]

const SEVERITY = ['HIGH', 'MEDIUM', 'LOW'] as const
export type StrategistInsightSeverityKey = (typeof SEVERITY)[number]

const DEDUPE_WINDOW_HOURS = 24

// ─── Schemas zod ────────────────────────────────────────────────────

const ListSchema = z.object({
  kind: z.enum(KIND).optional(),
  severity: z.enum(SEVERITY).optional(),
  status: z.enum(STATUS).optional(),
  workspaceId: z.string().min(1).nullish(),
  since: z.string().datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional().default(25),
})
export type ListStrategistInsightsInput = z.input<typeof ListSchema>

const IdSchema = z.object({ id: z.string().min(1) })
const AckSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1).optional(),
})

// ─── Signature dedupe ───────────────────────────────────────────────

/**
 * Calcula una firma estable (orden-independiente) del payload del
 * insight para detectar duplicados dentro de la ventana de dedupe.
 *
 * Para `resource_contention` usamos `userId + sorted(projectIds)`,
 * para `dependency_conflict` usamos `predecessorTaskId + successorTaskId`,
 * y para `reusable_lesson` usamos `sourceProject + category + title`.
 * Otros kinds caen al fallback (JSON ordenado).
 */
function signatureFor(
  kind: StrategistInsightKindKey,
  payload: Record<string, unknown>,
): string {
  switch (kind) {
    case 'RESOURCE_CONTENTION': {
      const userId = String(payload.userId ?? '')
      const projects = Array.isArray(payload.projects)
        ? (payload.projects as Array<{ id?: string }>)
            .map((p) => String(p?.id ?? ''))
            .sort()
            .join('|')
        : ''
      return `RC:${userId}:${projects}`
    }
    case 'DEPENDENCY_CONFLICT': {
      const pred =
        (payload.predecessor as { taskId?: string } | undefined)?.taskId ?? ''
      const suc =
        (payload.successor as { taskId?: string } | undefined)?.taskId ?? ''
      return `DC:${pred}:${suc}`
    }
    case 'REUSABLE_LESSON': {
      const src = String(payload.sourceProject ?? '')
      const cat = String(payload.category ?? '')
      const title = String(payload.title ?? '')
      return `RL:${src}:${cat}:${title}`
    }
    default: {
      // Fallback: stringify con keys ordenadas.
      const ordered = Object.keys(payload)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = payload[k]
          return acc
        }, {})
      return `${kind}:${JSON.stringify(ordered)}`
    }
  }
}

function summaryFor(
  kind: StrategistInsightKindKey,
  payload: Record<string, unknown>,
): string {
  switch (kind) {
    case 'RESOURCE_CONTENTION': {
      const user = String(payload.userName ?? payload.userId ?? '—')
      const days = Number(payload.overlapDays ?? 0)
      const projects = Array.isArray(payload.projects)
        ? (payload.projects as Array<{ name?: string }>).length
        : 0
      return `${user} con ${days} días de solape en ${projects} proyectos.`
    }
    case 'DEPENDENCY_CONFLICT': {
      const gap = Math.abs(Number(payload.gapDays ?? 0))
      const pred =
        (payload.predecessor as { title?: string } | undefined)?.title ?? '—'
      const suc =
        (payload.successor as { title?: string } | undefined)?.title ?? '—'
      return `"${suc}" inicia ${gap} días antes que termine "${pred}".`
    }
    case 'REUSABLE_LESSON': {
      const title = String(payload.title ?? '—')
      const src = String(payload.sourceProject ?? '—')
      return `Lección "${title}" de ${src} aplicable a otros proyectos.`
    }
    case 'PREDICTIVE_SCENARIO': {
      const delay = Number(payload.delayDays ?? 0)
      const affected = Array.isArray(payload.affected)
        ? (payload.affected as unknown[]).length
        : 0
      return `Escenario predictivo · ${delay} días de retraso · ${affected} tareas afectadas.`
    }
    case 'BALANCE_SUGGESTION': {
      const msg = String(payload.message ?? 'Sugerencia de balanceo.')
      return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg
    }
  }
}

// ─── persistStrategistReport ────────────────────────────────────────

export interface PersistStrategistReportResult {
  created: number
  skipped: number
  total: number
}

/**
 * Explota un `StrategistReport` en filas `BrainStrategistInsight`.
 *
 * Dedupe: si existe ya un row con la misma signature y status
 * NEW/ACKNOWLEDGED creado en las últimas {@link DEDUPE_WINDOW_HOURS}
 * horas, se omite. Los reportes RESOLVED/DISMISSED no bloquean
 * la persistencia de un nuevo insight (se considera "vuelve a aparecer").
 */
export async function persistStrategistReport(
  report: StrategistReport,
  workspaceId?: string | null,
): Promise<PersistStrategistReportResult> {
  await requireUser()

  const wsId = workspaceId ?? null
  const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000)

  // Aplana las 3 secciones del report en una lista uniforme.
  type Pending = {
    kind: StrategistInsightKindKey
    severity: StrategistInsightSeverityKey
    payload: Record<string, unknown>
    signature: string
    summary: string
  }
  const pending: Pending[] = []

  for (const i of report.resourceContention) {
    const payload = {
      userId: i.userId,
      userName: i.userName,
      overlapDays: i.overlapDays,
      projects: i.projects,
      recommendation: i.recommendation,
    } as Record<string, unknown>
    pending.push({
      kind: 'RESOURCE_CONTENTION',
      severity: i.severity,
      payload,
      signature: signatureFor('RESOURCE_CONTENTION', payload),
      summary: summaryFor('RESOURCE_CONTENTION', payload),
    })
  }
  for (const i of report.dependencyConflicts) {
    const payload = {
      predecessor: i.predecessor,
      successor: i.successor,
      gapDays: i.gapDays,
      recommendation: i.recommendation,
    } as Record<string, unknown>
    pending.push({
      kind: 'DEPENDENCY_CONFLICT',
      severity: i.severity,
      payload,
      signature: signatureFor('DEPENDENCY_CONFLICT', payload),
      summary: summaryFor('DEPENDENCY_CONFLICT', payload),
    })
  }
  for (const i of report.reusableLessons) {
    const payload = {
      sourceProject: i.sourceProject,
      category: i.category,
      title: i.title,
      recommendation: i.recommendation,
      applicableProjects: i.applicableProjects,
    } as Record<string, unknown>
    pending.push({
      kind: 'REUSABLE_LESSON',
      severity: i.severity,
      payload,
      signature: signatureFor('REUSABLE_LESSON', payload),
      summary: summaryFor('REUSABLE_LESSON', payload),
    })
  }

  if (pending.length === 0) {
    return { created: 0, skipped: 0, total: 0 }
  }

  // Cargar candidatos recientes (mismo kind + workspace) para dedupe.
  const recents = await prisma.brainStrategistInsight.findMany({
    where: {
      workspaceId: wsId,
      kind: { in: Array.from(new Set(pending.map((p) => p.kind))) },
      status: { in: ['NEW', 'ACKNOWLEDGED'] },
      createdAt: { gte: dedupeSince },
    },
    select: { id: true, kind: true, payload: true },
  })
  const seen = new Set<string>()
  for (const r of recents) {
    if (!r.payload || typeof r.payload !== 'object') continue
    const sig = signatureFor(
      r.kind as StrategistInsightKindKey,
      r.payload as Record<string, unknown>,
    )
    seen.add(sig)
  }

  let created = 0
  let skipped = 0
  for (const item of pending) {
    if (seen.has(item.signature)) {
      skipped++
      continue
    }
    await prisma.brainStrategistInsight.create({
      data: {
        workspaceId: wsId,
        kind: item.kind,
        severity: item.severity,
        payload: item.payload as Prisma.InputJsonValue,
        summary: item.summary,
        status: 'NEW',
      },
    })
    seen.add(item.signature) // evita crear dos veces el mismo insight dentro del mismo report
    created++
  }

  return { created, skipped, total: pending.length }
}

// ─── listStrategistInsights ─────────────────────────────────────────

export interface StrategistInsightRow {
  id: string
  workspaceId: string | null
  kind: StrategistInsightKindKey
  severity: StrategistInsightSeverityKey
  payload: unknown
  summary: string | null
  status: StrategistInsightStatus
  ackById: string | null
  ackByName: string | null
  ackedAt: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ListStrategistInsightsResult {
  items: StrategistInsightRow[]
  nextCursor: string | null
}

function rowToDTO(
  row: BrainStrategistInsight & { ackBy?: { name: string } | null },
): StrategistInsightRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind as StrategistInsightKindKey,
    severity: row.severity as StrategistInsightSeverityKey,
    payload: row.payload,
    summary: row.summary,
    status: row.status as StrategistInsightStatus,
    ackById: row.ackById,
    ackByName: row.ackBy?.name ?? null,
    ackedAt: row.ackedAt ? row.ackedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Lista insights persistidos con filtros opcionales y paginación
 * cursor-based (ordenado por createdAt DESC + id DESC para estabilidad).
 */
export async function listStrategistInsights(
  input: ListStrategistInsightsInput = {},
): Promise<ListStrategistInsightsResult> {
  await requireUser()

  const parsed = ListSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(
      `[INVALID_INPUT] ${parsed.error.issues.map((i) => i.message).join(', ')}`,
    )
  }
  const { kind, severity, status, workspaceId, since, cursor, limit } =
    parsed.data

  const where: Prisma.BrainStrategistInsightWhereInput = {
    ...(kind ? { kind } : {}),
    ...(severity ? { severity } : {}),
    ...(status ? { status } : {}),
    ...(workspaceId !== undefined
      ? workspaceId === null
        ? { workspaceId: null }
        : { workspaceId }
      : {}),
    ...(since ? { createdAt: { gte: new Date(since) } } : {}),
  }

  const rows = await prisma.brainStrategistInsight.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { ackBy: { select: { name: true } } },
  })

  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? sliced[sliced.length - 1].id : null

  return {
    items: sliced.map(rowToDTO),
    nextCursor,
  }
}

// ─── acknowledgeInsight ─────────────────────────────────────────────

export async function acknowledgeInsight(input: {
  id: string
  userId?: string
}): Promise<StrategistInsightRow> {
  const user = await requireUser()

  const parsed = AckSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('[INVALID_INPUT] id requerido')
  }

  const actorId = parsed.data.userId ?? user.id

  const existing = await prisma.brainStrategistInsight.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, status: true },
  })
  if (!existing) {
    throw new Error('[NOT_FOUND] Insight no existe')
  }
  if (existing.status !== 'NEW') {
    throw new Error(
      `[INVALID_STATE] Solo se puede ACK desde NEW (estado actual: ${existing.status})`,
    )
  }

  const updated = await prisma.brainStrategistInsight.update({
    where: { id: parsed.data.id },
    data: {
      status: 'ACKNOWLEDGED',
      ackById: actorId,
      ackedAt: new Date(),
    },
    include: { ackBy: { select: { name: true } } },
  })
  return rowToDTO(updated)
}

// ─── resolveInsight ─────────────────────────────────────────────────

export async function resolveInsight(input: {
  id: string
}): Promise<StrategistInsightRow> {
  await requireUser()

  const parsed = IdSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('[INVALID_INPUT] id requerido')
  }

  const existing = await prisma.brainStrategistInsight.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, status: true },
  })
  if (!existing) {
    throw new Error('[NOT_FOUND] Insight no existe')
  }
  if (existing.status === 'RESOLVED' || existing.status === 'DISMISSED') {
    throw new Error(
      `[INVALID_STATE] No se puede resolver desde ${existing.status}`,
    )
  }

  const updated = await prisma.brainStrategistInsight.update({
    where: { id: parsed.data.id },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
    include: { ackBy: { select: { name: true } } },
  })
  return rowToDTO(updated)
}

// ─── dismissInsight ─────────────────────────────────────────────────

export async function dismissInsight(input: {
  id: string
}): Promise<StrategistInsightRow> {
  await requireUser()

  const parsed = IdSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('[INVALID_INPUT] id requerido')
  }

  const existing = await prisma.brainStrategistInsight.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, status: true },
  })
  if (!existing) {
    throw new Error('[NOT_FOUND] Insight no existe')
  }

  const updated = await prisma.brainStrategistInsight.update({
    where: { id: parsed.data.id },
    data: { status: 'DISMISSED' },
    include: { ackBy: { select: { name: true } } },
  })
  return rowToDTO(updated)
}
