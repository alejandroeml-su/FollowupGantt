'use server'

/**
 * Server actions para Sprint lifecycle + Story Points + Velocity (Ola P2 · Equipo P2-2).
 *
 * Convenciones:
 *  - Errores tipados `[CODE] detalle` (alineado con `reorder.ts`/`schedule.ts`).
 *  - Validación con zod + escala Fibonacci canónica.
 *  - Tras mutar, `revalidatePath` de `/sprints` + las vistas que muestran
 *    información de tareas (`/list`, `/kanban`, `/gantt`, etc.).
 *  - El cálculo "puro" vive en `@/lib/agile/burndown` (sin I/O); aquí sólo
 *    orquestamos lectura y escritura.
 *
 * El módulo Prisma todavía no expone los nuevos campos cuando el cliente
 * no se ha regenerado en CI; usamos el patrón `prisma as unknown as {...}`
 * que ya emplean `calendars.ts` y `custom-fields.ts` para no atar el
 * tipo a un build incremental que pudiera fallar en pipelines fríos.
 */

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import {
  FIBONACCI_STORY_POINTS,
  computeBurndown,
  computeSprintMetrics,
  computeVelocity,
  isValidStoryPoints,
  type BurndownPoint,
  type SprintMetrics,
  type VelocityPoint,
} from '@/lib/agile/burndown'

export type SprintErrorCode =
  | 'SPRINT_NOT_FOUND'
  | 'SPRINT_ALREADY_ACTIVE'
  | 'SPRINT_NOT_ACTIVE'
  | 'INVALID_STORY_POINTS'
  | 'INVALID_INPUT'
  | 'TASK_NOT_FOUND'
  | 'PROJECT_MISMATCH'

function actionError(code: SprintErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

const SPRINT_VIEW_PATHS = [
  '/sprints',
  '/list',
  '/kanban',
  '/gantt',
  '/table',
  '/dashboards',
] as const

function revalidateSprintViews() {
  for (const p of SPRINT_VIEW_PATHS) revalidatePath(p)
}

// ────────────── Tipos públicos (lo que consume la UI) ──────────────

export interface SprintSummary {
  id: string
  name: string
  goal: string | null
  status: string
  startDate: string
  endDate: string
  startedAt: string | null
  endedAt: string | null
  capacity: number | null
  velocityActual: number | null
  totalPoints: number
  completedPoints: number
  taskCount: number
}

// ────────────── Helpers internos ───────────────────────────────────

type PrismaSprintRecord = {
  id: string
  name: string
  goal: string | null
  status: string
  startDate: Date
  endDate: Date
  startedAt: Date | null
  endedAt: Date | null
  capacity: number | null
  velocityActual: number | null
  projectId: string
  createdAt: Date
}

type PrismaTaskRecord = {
  id: string
  status: string
  storyPoints: number | null
  sprintId: string | null
  projectId: string
  updatedAt: Date
}

const sprintClient = () =>
  (prisma as unknown as {
    sprint: {
      findUnique: (a: unknown) => Promise<PrismaSprintRecord | null>
      findMany: (a: unknown) => Promise<PrismaSprintRecord[]>
      update: (a: unknown) => Promise<PrismaSprintRecord>
    }
  }).sprint

const taskClient = () =>
  (prisma as unknown as {
    task: {
      findUnique: (a: unknown) => Promise<PrismaTaskRecord | null>
      findMany: (a: unknown) => Promise<PrismaTaskRecord[]>
      update: (a: unknown) => Promise<PrismaTaskRecord>
    }
  }).task

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

// ────────────── Lifecycle: start/end sprint ────────────────────────

/**
 * Inicia un sprint (status PLANNING → ACTIVE) y registra `startedAt = now()`.
 * Falla si:
 *   - El sprint no existe ⇒ `[SPRINT_NOT_FOUND]`.
 *   - El sprint ya está ACTIVE o COMPLETED ⇒ `[SPRINT_ALREADY_ACTIVE]`.
 */
export async function startSprint(sprintId: string): Promise<{ ok: true }> {
  if (!sprintId) actionError('SPRINT_NOT_FOUND', 'sprintId requerido')

  const current = await sprintClient().findUnique({
    where: { id: sprintId },
    select: { id: true, status: true, startedAt: true },
  })
  if (!current) actionError('SPRINT_NOT_FOUND', `sprintId=${sprintId}`)

  if (current.status === 'ACTIVE' || current.startedAt) {
    actionError('SPRINT_ALREADY_ACTIVE', 'el sprint ya está iniciado')
  }
  if (current.status === 'COMPLETED') {
    actionError('SPRINT_ALREADY_ACTIVE', 'el sprint ya está cerrado')
  }

  await sprintClient().update({
    where: { id: sprintId },
    data: { status: 'ACTIVE', startedAt: new Date() },
  })

  revalidateSprintViews()
  return { ok: true as const }
}

/**
 * Cierra un sprint (status ACTIVE → COMPLETED) y persiste `velocityActual`
 * = suma de `storyPoints` de tasks DONE asignadas al sprint.
 *
 * Decisión: incluso si una tarea cambia de status DESPUÉS del cierre, el
 * `velocityActual` queda congelado al snapshot de este momento (es la
 * métrica que usa el VelocityChart, no se recalcula).
 */
export async function endSprint(
  sprintId: string,
): Promise<{ ok: true; velocityActual: number }> {
  if (!sprintId) actionError('SPRINT_NOT_FOUND', 'sprintId requerido')

  const current = await sprintClient().findUnique({
    where: { id: sprintId },
    select: { id: true, status: true, startedAt: true },
  })
  if (!current) actionError('SPRINT_NOT_FOUND', `sprintId=${sprintId}`)
  if (current.status !== 'ACTIVE') {
    actionError('SPRINT_NOT_ACTIVE', 'sólo sprints ACTIVE pueden cerrarse')
  }

  const doneTasks = await taskClient().findMany({
    where: { sprintId, status: 'DONE' },
    select: { id: true, storyPoints: true },
  })
  const velocityActual = doneTasks.reduce(
    (sum, t) => sum + (typeof t.storyPoints === 'number' ? t.storyPoints : 0),
    0,
  )

  await sprintClient().update({
    where: { id: sprintId },
    data: {
      status: 'COMPLETED',
      endedAt: new Date(),
      velocityActual,
    },
  })

  revalidateSprintViews()
  return { ok: true as const, velocityActual }
}

// ────────────── Asignación de tareas a sprint ──────────────────────

/**
 * Asigna una tarea a un sprint. La tarea y el sprint deben pertenecer al
 * mismo proyecto: cruzamos esa validación porque Prisma no la enforce
 * (sprintId es FK simple).
 */
export async function assignTaskToSprint(
  taskId: string,
  sprintId: string,
): Promise<{ ok: true }> {
  if (!taskId) actionError('TASK_NOT_FOUND', 'taskId requerido')
  if (!sprintId) actionError('SPRINT_NOT_FOUND', 'sprintId requerido')

  const [task, sprint] = await Promise.all([
    taskClient().findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    }),
    sprintClient().findUnique({
      where: { id: sprintId },
      select: { id: true, projectId: true },
    }),
  ])
  if (!task) actionError('TASK_NOT_FOUND', `taskId=${taskId}`)
  if (!sprint) actionError('SPRINT_NOT_FOUND', `sprintId=${sprintId}`)
  if (task.projectId !== sprint.projectId) {
    actionError(
      'PROJECT_MISMATCH',
      'task y sprint deben pertenecer al mismo proyecto',
    )
  }

  await taskClient().update({
    where: { id: taskId },
    data: { sprintId },
  })

  revalidateSprintViews()
  return { ok: true as const }
}

/** Saca una tarea del sprint (sprintId → null). */
export async function removeTaskFromSprint(
  taskId: string,
): Promise<{ ok: true }> {
  if (!taskId) actionError('TASK_NOT_FOUND', 'taskId requerido')

  const task = await taskClient().findUnique({
    where: { id: taskId },
    select: { id: true },
  })
  if (!task) actionError('TASK_NOT_FOUND', `taskId=${taskId}`)

  await taskClient().update({
    where: { id: taskId },
    data: { sprintId: null },
  })

  revalidateSprintViews()
  return { ok: true as const }
}

// ────────────── Story points ───────────────────────────────────────

const storyPointsSchema = z.object({
  taskId: z.string().min(1),
  storyPoints: z.union([z.number().int(), z.null()]),
})

/**
 * Setea (o limpia) los story points de una tarea. `null` desestima la
 * estimación. El valor sólo puede ser uno de `FIBONACCI_STORY_POINTS`.
 */
export async function setTaskStoryPoints(input: {
  taskId: string
  storyPoints: number | null
}): Promise<{ ok: true; storyPoints: number | null }> {
  const parsed = storyPointsSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  const { taskId, storyPoints } = parsed.data

  if (storyPoints !== null && !isValidStoryPoints(storyPoints)) {
    actionError(
      'INVALID_STORY_POINTS',
      `valor ${storyPoints} fuera de la escala Fibonacci [${FIBONACCI_STORY_POINTS.join(',')}]`,
    )
  }

  const task = await taskClient().findUnique({
    where: { id: taskId },
    select: { id: true },
  })
  if (!task) actionError('TASK_NOT_FOUND', `taskId=${taskId}`)

  await taskClient().update({
    where: { id: taskId },
    data: { storyPoints },
  })

  revalidateSprintViews()
  return { ok: true as const, storyPoints }
}

// ────────────── Métricas y datos para charts ───────────────────────

/**
 * Devuelve métricas agregadas del sprint sobre puntos de historia.
 * Útil para mostrar en la cabecera del SprintBoard ("12 / 30 pts").
 */
export async function getSprintMetrics(
  sprintId: string,
): Promise<SprintMetrics> {
  if (!sprintId) actionError('SPRINT_NOT_FOUND', 'sprintId requerido')

  const sprint = await sprintClient().findUnique({
    where: { id: sprintId },
    select: { id: true },
  })
  if (!sprint) actionError('SPRINT_NOT_FOUND', `sprintId=${sprintId}`)

  const tasks = await taskClient().findMany({
    where: { sprintId },
    select: { status: true, storyPoints: true },
  })

  return computeSprintMetrics(tasks)
}

/**
 * Devuelve los últimos `lastN` sprints del proyecto en orden cronológico
 * ascendente, con su capacity y velocity. El consumidor del chart no
 * necesita reordenar.
 */
export async function getVelocityHistory(
  projectId: string,
  lastN = 10,
): Promise<VelocityPoint[]> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId requerido')
  if (!Number.isInteger(lastN) || lastN <= 0) {
    actionError('INVALID_INPUT', 'lastN debe ser un entero positivo')
  }

  const sprints = await sprintClient().findMany({
    where: { projectId },
    orderBy: [{ endedAt: 'desc' }, { endDate: 'desc' }, { createdAt: 'desc' }],
    take: lastN,
    select: {
      id: true,
      name: true,
      capacity: true,
      velocityActual: true,
      endedAt: true,
      endDate: true,
      createdAt: true,
    },
  })

  return computeVelocity(sprints as unknown as Parameters<typeof computeVelocity>[0])
}

/**
 * Devuelve la serie de puntos para el chart de burndown del sprint.
 * Wrapper sobre `computeBurndown` que carga sprint + tasks en una sola
 * round-trip y delega el cálculo al helper puro.
 */
export async function getBurndownData(
  sprintId: string,
  today: Date = new Date(),
): Promise<BurndownPoint[]> {
  if (!sprintId) actionError('SPRINT_NOT_FOUND', 'sprintId requerido')

  const sprint = await sprintClient().findUnique({
    where: { id: sprintId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      capacity: true,
    },
  })
  if (!sprint) actionError('SPRINT_NOT_FOUND', `sprintId=${sprintId}`)

  const tasks = await taskClient().findMany({
    where: { sprintId },
    select: { status: true, storyPoints: true, updatedAt: true },
  })

  return computeBurndown(
    {
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      capacity: sprint.capacity,
    },
    tasks,
    today,
  )
}

// ────────────── Lectura para vista `/sprints` ──────────────────────

/**
 * Lista los sprints de un proyecto con métricas agregadas para la vista
 * `/sprints`. Hacemos los conteos en server side para que el cliente no
 * tenga que cargar todas las tareas.
 */
export async function getSprintsWithMetrics(
  projectId: string,
): Promise<SprintSummary[]> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId requerido')

  const sprints = await sprintClient().findMany({
    where: { projectId },
    orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
    select: {
      id: true,
      name: true,
      goal: true,
      status: true,
      startDate: true,
      endDate: true,
      startedAt: true,
      endedAt: true,
      capacity: true,
      velocityActual: true,
      projectId: true,
      createdAt: true,
    },
  })

  if (sprints.length === 0) return []

  const sprintIds = sprints.map((s) => s.id)
  const tasks = await taskClient().findMany({
    where: { sprintId: { in: sprintIds } },
    select: { sprintId: true, status: true, storyPoints: true },
  })

  const grouped = new Map<string, Array<{ status: string; storyPoints: number | null }>>()
  for (const t of tasks) {
    if (!t.sprintId) continue
    const arr = grouped.get(t.sprintId) ?? []
    arr.push({ status: t.status, storyPoints: t.storyPoints })
    grouped.set(t.sprintId, arr)
  }

  return sprints.map((s) => {
    const sprintTasks = grouped.get(s.id) ?? []
    const metrics = computeSprintMetrics(sprintTasks)
    return {
      id: s.id,
      name: s.name,
      goal: s.goal,
      status: s.status,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
      startedAt: toIso(s.startedAt),
      endedAt: toIso(s.endedAt),
      capacity: s.capacity,
      velocityActual: s.velocityActual,
      totalPoints: metrics.totalPoints,
      completedPoints: metrics.completedPoints,
      taskCount: sprintTasks.length,
    } satisfies SprintSummary
  })
}

/**
 * Tareas del proyecto SIN sprint asignado (backlog). Incluye `storyPoints`
 * y status para el componente `SprintBacklog`.
 */
export async function getProjectBacklog(projectId: string) {
  if (!projectId) actionError('INVALID_INPUT', 'projectId requerido')
  const tasks = await (prisma as unknown as {
    task: {
      findMany: (a: unknown) => Promise<
        Array<{
          id: string
          mnemonic: string | null
          title: string
          status: string
          priority: string
          storyPoints: number | null
        }>
      >
    }
  }).task.findMany({
    where: {
      projectId,
      sprintId: null,
      archivedAt: null,
      parentId: null,
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      mnemonic: true,
      title: true,
      status: true,
      priority: true,
      storyPoints: true,
    },
  })
  return tasks
}

/**
 * Tareas asignadas a un sprint (para el SprintBoard). No incluye subtasks
 * (parentId IS NULL) — alineado con `kanban/page.tsx`.
 */
export async function getSprintTasks(sprintId: string) {
  if (!sprintId) actionError('SPRINT_NOT_FOUND', 'sprintId requerido')
  const tasks = await (prisma as unknown as {
    task: {
      findMany: (a: unknown) => Promise<
        Array<{
          id: string
          mnemonic: string | null
          title: string
          status: string
          priority: string
          storyPoints: number | null
          assignee: { id: string; name: string } | null
        }>
      >
    }
  }).task.findMany({
    where: { sprintId, archivedAt: null, parentId: null },
    orderBy: [{ status: 'asc' }, { priority: 'desc' }],
    select: {
      id: true,
      mnemonic: true,
      title: true,
      status: true,
      priority: true,
      storyPoints: true,
      assignee: { select: { id: true, name: true } },
    },
  })
  return tasks
}

// ────────────── Sprint create/update con capacity ──────────────────

const sprintCreateSchema = z.object({
  name: z.string().min(1).max(120),
  projectId: z.string().min(1),
  goal: z.string().optional().nullable(),
  startDate: z.union([z.string(), z.date()]),
  endDate: z.union([z.string(), z.date()]),
  capacity: z.number().int().min(0).max(10_000).optional().nullable(),
})

/**
 * Crea un sprint (versión enriquecida de `actions.ts#createSprint` que
 * acepta `capacity` desde el modal de planeación). El `actions.ts` viejo
 * sigue disponible para formularios legacy.
 */
export async function createSprintWithCapacity(input: {
  name: string
  projectId: string
  goal?: string | null
  startDate: string | Date
  endDate: string | Date
  capacity?: number | null
}): Promise<{ id: string }> {
  const parsed = sprintCreateSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  const data = parsed.data

  const start = new Date(data.startDate as string)
  const end = new Date(data.endDate as string)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    actionError('INVALID_INPUT', 'fechas inválidas')
  }
  if (start > end) actionError('INVALID_INPUT', 'startDate debe ser ≤ endDate')

  const created = await (prisma as unknown as {
    sprint: { create: (a: unknown) => Promise<{ id: string }> }
  }).sprint.create({
    data: {
      name: data.name,
      projectId: data.projectId,
      goal: data.goal ?? null,
      startDate: start,
      endDate: end,
      capacity: data.capacity ?? null,
    },
  })

  revalidateSprintViews()
  return { id: created.id }
}
