/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Builder de contexto.
 *
 * Lee desde Prisma los datos relevantes para un standup matutino y
 * los agrega en buckets `yesterday` / `today` / `blockers`. Sin LLM,
 * sin formato narrativo: sólo data structures listas para que
 * `generate-standup.ts` (LLM) o `heuristic-standup.ts` (fallback)
 * produzcan el output.
 *
 * Diseño determinista:
 *   - El `now` y un `prisma` opcional se inyectan para que los tests
 *     unitarios puedan stubear consultas sin docker/Postgres.
 *   - "Últimas 24h" se calcula como `now - 24h`. La fecha del standup
 *     es `today = startOfUTCDay(now)` (consistente con cron diario).
 *   - "Hito cercano" = `isMilestone && endDate ∈ [now, now + 7d]`.
 *   - "Blocker" = `(endDate < now && status !== DONE) || (status !== DONE && !assigneeId)`.
 *     `DELAYED` no existe como TaskStatus en el schema actual; se deriva
 *     a partir de `endDate < now`.
 *
 * No hay efectos de escritura: este módulo es puro read.
 */

import 'server-only'

import type { Prisma, PrismaClient, TaskStatus } from '@prisma/client'
import prismaDefault from '@/lib/prisma'

// ─────────────────────────── Tipos públicos ────────────────────────────

export interface StandupTaskSnapshot {
  id: string
  title: string
  status: TaskStatus
  progress: number
  endDate: Date | null
  isMilestone: boolean
  assigneeId: string | null
  assigneeName: string | null
  assigneeEmail: string | null
  projectId: string
  projectName: string
  /**
   * Razón por la que la task se considera blocker. `null` para tasks
   * yesterday/today.
   */
  blockerReason?: BlockerReason | null
}

export type BlockerReason =
  | 'OVERDUE'
  | 'NO_ASSIGNEE'
  | 'BROKEN_DEPENDENCY'
  | 'STALE'

export interface StandupContext {
  /** Scope del contexto. Conditiona prompt/heurística. */
  scope: 'project' | 'user'
  /** ID del proyecto o del usuario, según scope. */
  scopeId: string
  /** Fecha del standup (UTC, midnight) en ISO YYYY-MM-DD. */
  date: string
  /** Tareas DONE en últimas 24h. */
  yesterday: StandupTaskSnapshot[]
  /** Tareas IN_PROGRESS + hitos próximos (próximos 7 días). */
  today: StandupTaskSnapshot[]
  /** Bloqueos detectados. */
  blockers: StandupTaskSnapshot[]
  /** Comentarios creados en últimas 24h (señal de actividad). */
  recentComments: Array<{
    id: string
    taskId: string
    taskTitle: string
    authorName: string | null
    createdAt: Date
  }>
  /** Metadata para enriquecer el prompt. */
  meta: {
    projectName?: string
    projectId?: string
    sprintName?: string | null
    upcomingMilestones: Array<{
      id: string
      title: string
      endDate: Date
      projectName: string
    }>
    /** Lista deduplicada de displayNames participantes. */
    participants: string[]
  }
}

export interface BuildStandupOptions {
  now?: Date
  /** Permite inyectar prisma stub en tests. */
  prisma?: Pick<PrismaClient, 'task' | 'comment' | 'project'>
  /**
   * Ventana hacia atrás para considerar "ayer" (en horas). Default 24h.
   * Útil para cubrir cron de fines de semana (lunes mira últimas 72h).
   */
  lookbackHours?: number
  /**
   * Ventana hacia adelante para hitos "próximos" (en días). Default 7.
   */
  upcomingDays?: number
}

// ─────────────────────────── Helpers ───────────────────────────────────

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function displayName(u: {
  name: string | null
  email: string | null
} | null): string {
  if (!u) return 'Sin asignar'
  return u.name?.trim() || u.email?.trim() || 'Sin asignar'
}

const taskInclude = {
  assignee: { select: { id: true, name: true, email: true } },
  project: { select: { id: true, name: true } },
  predecessors: {
    select: {
      predecessor: { select: { id: true, status: true, endDate: true } },
    },
  },
} satisfies Prisma.TaskInclude

type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>

function toSnapshot(
  t: TaskWithRelations,
  blockerReason: BlockerReason | null = null,
): StandupTaskSnapshot {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    progress: t.progress,
    endDate: t.endDate,
    isMilestone: t.isMilestone,
    assigneeId: t.assignee?.id ?? null,
    assigneeName: t.assignee?.name ?? null,
    assigneeEmail: t.assignee?.email ?? null,
    projectId: t.project.id,
    projectName: t.project.name,
    blockerReason,
  }
}

/**
 * Detecta el motivo de bloqueo. Retorna `null` si la task no aplica.
 * Orden de prioridad: NO_ASSIGNEE > BROKEN_DEPENDENCY > OVERDUE > STALE.
 */
function detectBlockerReason(
  t: TaskWithRelations,
  now: Date,
): BlockerReason | null {
  if (t.status === 'DONE' || t.archivedAt) return null
  if (!t.assigneeId) return 'NO_ASSIGNEE'

  // Dependencia rota: predecessor sin DONE pero ya pasó su endDate.
  for (const dep of t.predecessors) {
    const p = dep.predecessor
    if (!p) continue
    if (p.status !== 'DONE' && p.endDate && p.endDate < now) {
      return 'BROKEN_DEPENDENCY'
    }
  }

  if (t.endDate && t.endDate < now) return 'OVERDUE'

  // Stale = IN_PROGRESS sin updates en los últimos 7 días.
  const STALE_MS = 7 * DAY_MS
  if (
    t.status === 'IN_PROGRESS' &&
    now.getTime() - t.updatedAt.getTime() > STALE_MS
  ) {
    return 'STALE'
  }

  return null
}

// ─────────────────────────── Builders ──────────────────────────────────

/**
 * Construye el contexto de standup para un proyecto. Lanza
 * `[NOT_FOUND] proyecto inexistente` si el `projectId` no existe.
 */
export async function buildProjectStandupContext(
  projectId: string,
  opts: BuildStandupOptions = {},
): Promise<StandupContext> {
  if (!projectId) {
    throw new Error('[INVALID_INPUT] projectId requerido')
  }

  const now = opts.now ?? new Date()
  const lookback = (opts.lookbackHours ?? 24) * HOUR_MS
  const since = new Date(now.getTime() - lookback)
  const upcoming = new Date(
    now.getTime() + (opts.upcomingDays ?? 7) * DAY_MS,
  )
  const prisma = (opts.prisma ?? prismaDefault) as PrismaClient

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) {
    throw new Error(`[NOT_FOUND] proyecto ${projectId} no existe`)
  }

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      archivedAt: null,
    },
    include: taskInclude,
  })

  const recentComments = await prisma.comment.findMany({
    where: {
      task: { projectId, archivedAt: null },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      createdAt: true,
      author: { select: { name: true, email: true } },
      task: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return assembleContext({
    scope: 'project',
    scopeId: projectId,
    now,
    since,
    upcoming,
    tasks,
    comments: recentComments,
    meta: {
      projectName: project.name,
      projectId: project.id,
    },
  })
}

/**
 * Construye el contexto para un usuario individual. Considera tasks donde
 * el user es `assignee` o `collaborator` (TaskCollaborator).
 */
export async function buildUserStandupContext(
  userId: string,
  opts: BuildStandupOptions = {},
): Promise<StandupContext> {
  if (!userId) {
    throw new Error('[INVALID_INPUT] userId requerido')
  }

  const now = opts.now ?? new Date()
  const lookback = (opts.lookbackHours ?? 24) * HOUR_MS
  const since = new Date(now.getTime() - lookback)
  const upcoming = new Date(
    now.getTime() + (opts.upcomingDays ?? 7) * DAY_MS,
  )
  const prisma = (opts.prisma ?? prismaDefault) as PrismaClient

  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      OR: [
        { assigneeId: userId },
        { collaborators: { some: { userId } } },
      ],
    },
    include: taskInclude,
  })

  const recentComments = await prisma.comment.findMany({
    where: {
      authorId: userId,
      createdAt: { gte: since },
    },
    select: {
      id: true,
      createdAt: true,
      author: { select: { name: true, email: true } },
      task: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return assembleContext({
    scope: 'user',
    scopeId: userId,
    now,
    since,
    upcoming,
    tasks,
    comments: recentComments,
  })
}

// ─────────────────────────── Ensamblador interno ───────────────────────

interface AssembleInput {
  scope: 'project' | 'user'
  scopeId: string
  now: Date
  since: Date
  upcoming: Date
  tasks: TaskWithRelations[]
  comments: Array<{
    id: string
    createdAt: Date
    author: { name: string | null; email: string | null } | null
    task: { id: string; title: string }
  }>
  meta?: {
    projectName?: string
    projectId?: string
  }
}

function assembleContext(input: AssembleInput): StandupContext {
  const { scope, scopeId, now, since, upcoming, tasks, comments } = input

  const yesterday: StandupTaskSnapshot[] = []
  const today: StandupTaskSnapshot[] = []
  const blockers: StandupTaskSnapshot[] = []
  const upcomingMilestones: StandupContext['meta']['upcomingMilestones'] = []
  const participantsMap = new Map<string, string>()

  function trackParticipant(t: TaskWithRelations): void {
    if (!t.assignee) return
    const key = t.assignee.id
    if (!participantsMap.has(key)) {
      participantsMap.set(key, displayName(t.assignee))
    }
  }

  for (const t of tasks) {
    trackParticipant(t)

    // Yesterday: DONE en últimas 24h.
    if (t.status === 'DONE' && t.updatedAt >= since) {
      yesterday.push(toSnapshot(t))
      continue
    }

    // Blockers (puede traslapar con today; si es blocker, no lo metemos en today).
    const reason = detectBlockerReason(t, now)
    if (reason) {
      blockers.push(toSnapshot(t, reason))
      continue
    }

    // Today: IN_PROGRESS.
    if (t.status === 'IN_PROGRESS') {
      today.push(toSnapshot(t))
      continue
    }

    // Hitos próximos (TODO/REVIEW pero milestone con endDate en ventana).
    if (
      t.isMilestone &&
      t.endDate &&
      t.endDate >= now &&
      t.endDate <= upcoming
    ) {
      today.push(toSnapshot(t))
      upcomingMilestones.push({
        id: t.id,
        title: t.title,
        endDate: t.endDate,
        projectName: t.project.name,
      })
    }
  }

  // Ordenar para output estable: por proyecto + endDate ASC.
  const byEnd = (a: StandupTaskSnapshot, b: StandupTaskSnapshot): number => {
    const ea = a.endDate?.getTime() ?? Number.POSITIVE_INFINITY
    const eb = b.endDate?.getTime() ?? Number.POSITIVE_INFINITY
    if (ea !== eb) return ea - eb
    return a.title.localeCompare(b.title)
  }
  yesterday.sort(byEnd)
  today.sort(byEnd)
  blockers.sort(byEnd)
  upcomingMilestones.sort((a, b) => a.endDate.getTime() - b.endDate.getTime())

  return {
    scope,
    scopeId,
    date: isoDate(startOfUtcDay(now)),
    yesterday,
    today,
    blockers,
    recentComments: comments.map((c) => ({
      id: c.id,
      taskId: c.task.id,
      taskTitle: c.task.title,
      authorName: displayName(c.author),
      createdAt: c.createdAt,
    })),
    meta: {
      projectName: input.meta?.projectName,
      projectId: input.meta?.projectId,
      sprintName: null,
      upcomingMilestones,
      participants: Array.from(participantsMap.values()).sort(),
    },
  }
}

// ─────────────────────────── Re-exports util ───────────────────────────

export { displayName as standupDisplayName, isoDate as standupIsoDate }
