'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'
import { loadCpmInputForProject } from '@/lib/scheduling/prismaAdapter'
import {
  computeExtendedCpm,
  priorityToNumber,
  type ExtendedCpmInput,
  type ExtendedCpmTaskInput,
} from '@/lib/scheduling/cpm-extended'
import {
  checkHardDeadlines,
  summarizeHardDeadlineCheck,
  type HardDeadlineCheckResult,
} from '@/lib/scheduling/hard-deadline-check'
import {
  buildUniformCapacity,
  levelResources,
  type LevelingChange,
  type LevelingPlan,
} from '@/lib/scheduling/resource-leveling'
import {
  DEFAULT_WORKDAYS_BITMASK,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'

// ───────────────────────── Errores tipados ─────────────────────────

export type LevelingErrorCode =
  | 'INVALID_INPUT'
  | 'NO_VIOLATIONS'
  | 'CYCLE_DETECTED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'

function actionError(code: LevelingErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const planChangeSchema = z.object({
  taskId: z.string().min(1),
  proposedStart: z.string().datetime(),
  proposedEnd: z.string().datetime(),
  deltaDays: z.number().int(),
})

const applyPlanSchema = z.object({
  projectId: z.string().min(1),
  changes: z.array(planChangeSchema).min(1),
})

export type ApplyLevelingPlanInput = z.infer<typeof applyPlanSchema>

// ───────────────────────── Serializable types ─────────────────────────

export interface SerializableHardDeadlineEntry {
  taskId: string
  hardDeadline: string
  earlyFinish: string
  slackDays: number
}

export interface SerializableHardDeadlineCheck {
  violations: SerializableHardDeadlineEntry[]
  warnings: SerializableHardDeadlineEntry[]
  safe: SerializableHardDeadlineEntry[]
  summary: {
    totalWithDeadline: number
    violationCount: number
    warningCount: number
  }
}

export interface SerializableLevelingChange {
  taskId: string
  taskTitle: string
  assigneeId: string
  assigneeName: string | null
  originalStart: string
  proposedStart: string
  originalEnd: string
  proposedEnd: string
  deltaDays: number
  reason: LevelingChange['reason']
}

export interface SerializableLevelingPlan {
  changes: SerializableLevelingChange[]
  unresolved: SerializableLevelingChange[]
  overloadedDayCount: number
}

// ───────────────────────── Helpers ─────────────────────────

interface TaskRow {
  id: string
  title: string
  assigneeId: string | null
  assigneeName: string | null
  hardDeadline: Date | null
  dailyEffortHours: number | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
}

async function loadProjectMeta(projectId: string): Promise<{
  tasks: TaskRow[]
  workdayHours: number
  calendar: WorkCalendarLike | undefined
}> {
  // Cargar tareas con campos extra que no expone `prismaAdapter`. Mantenemos
  // el adapter intacto y aquí ampliamos.
  const tasksDb = await prisma.task.findMany({
    where: { projectId, archivedAt: null },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      priority: true,
      assignee: { select: { name: true } },
      // Los dos campos nuevos pueden no existir todavía en producción si la
      // migración SQL no ha corrido. Prisma generará el typecheck local pero
      // en runtime una BD vieja devolvería undefined; envolvemos en try.
    },
  })

  // Cargar hardDeadline / dailyEffortHours en una segunda query con
  // typecast suelto para tolerar BD pre-migración.
  let extras: Array<{
    id: string
    hardDeadline: Date | null
    dailyEffortHours: number | null
  }> = []
  try {
    extras = (await (prisma as unknown as {
      task: {
        findMany: (a: unknown) => Promise<
          Array<{
            id: string
            hardDeadline: Date | null
            dailyEffortHours: number | null
          }>
        >
      }
    }).task.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, hardDeadline: true, dailyEffortHours: true },
    })) ?? []
  } catch {
    extras = []
  }
  const extraById = new Map(extras.map((e) => [e.id, e]))

  const tasks: TaskRow[] = tasksDb.map((t) => ({
    id: t.id,
    title: t.title,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.name ?? null,
    hardDeadline: extraById.get(t.id)?.hardDeadline ?? null,
    dailyEffortHours: extraById.get(t.id)?.dailyEffortHours ?? null,
    priority: t.priority,
  }))

  // Calendar + workdayHours (mismo patrón que workload/page.tsx).
  let workdayHours = 8
  let calendar: WorkCalendarLike | undefined
  try {
    const project = await (prisma as unknown as {
      project: {
        findUnique: (a: unknown) => Promise<
          | {
              calendar: {
                workdays: number
                workdayHours: unknown
                holidays: Array<{ date: Date; recurring: boolean }>
              } | null
            }
          | null
        >
      }
    }).project.findUnique({
      where: { id: projectId },
      select: {
        calendar: {
          select: {
            workdays: true,
            workdayHours: true,
            holidays: { select: { date: true, recurring: true } },
          },
        },
      },
    })
    if (project?.calendar) {
      calendar = {
        workdays: project.calendar.workdays,
        holidays: project.calendar.holidays,
      }
      const wh = project.calendar.workdayHours
      workdayHours =
        typeof wh === 'object' && wh !== null
          ? Number((wh as { toString(): string }).toString())
          : Number(wh)
      if (!Number.isFinite(workdayHours) || workdayHours <= 0) workdayHours = 8
    } else {
      calendar = { workdays: DEFAULT_WORKDAYS_BITMASK, holidays: [] }
    }
  } catch {
    calendar = { workdays: DEFAULT_WORKDAYS_BITMASK, holidays: [] }
  }

  return { tasks, workdayHours, calendar }
}

function buildExtendedInput(
  baseInput: Awaited<ReturnType<typeof loadCpmInputForProject>>,
  meta: TaskRow[],
): ExtendedCpmInput {
  const metaById = new Map(meta.map((m) => [m.id, m]))
  const tasks: ExtendedCpmTaskInput[] = baseInput.tasks.map((t) => {
    const m = metaById.get(t.id)
    return {
      ...t,
      hardDeadline: m?.hardDeadline ?? null,
      dailyEffortHours: m?.dailyEffortHours ?? null,
      assigneeId: m?.assigneeId ?? null,
      priority: priorityToNumber(m?.priority),
    }
  })
  return {
    projectStart: baseInput.projectStart,
    tasks,
    dependencies: baseInput.dependencies,
    calendar: baseInput.calendar,
  }
}

function serializeHardDeadlineCheck(
  result: HardDeadlineCheckResult,
): SerializableHardDeadlineCheck {
  const ser = (e: HardDeadlineCheckResult['violations'][number]) => ({
    taskId: e.taskId,
    hardDeadline: e.hardDeadline.toISOString(),
    earlyFinish: e.earlyFinish.toISOString(),
    slackDays: e.slackDays,
  })
  return {
    violations: result.violations.map(ser),
    warnings: result.warnings.map(ser),
    safe: result.safe.map(ser),
    summary: summarizeHardDeadlineCheck(result),
  }
}

function serializeLevelingPlan(
  plan: LevelingPlan,
  tasksById: Map<string, TaskRow>,
): SerializableLevelingPlan {
  const ser = (c: LevelingChange): SerializableLevelingChange => {
    const meta = tasksById.get(c.taskId)
    return {
      taskId: c.taskId,
      taskTitle: meta?.title ?? c.taskId,
      assigneeId: c.assigneeId,
      assigneeName: meta?.assigneeName ?? null,
      originalStart: c.originalStart.toISOString(),
      proposedStart: c.proposedStart.toISOString(),
      originalEnd: c.originalEnd.toISOString(),
      proposedEnd: c.proposedEnd.toISOString(),
      deltaDays: c.deltaDays,
      reason: c.reason,
    }
  }
  return {
    changes: plan.changes.map(ser),
    unresolved: plan.unresolved.map(ser),
    overloadedDayCount: plan.overloadedDayCount,
  }
}

// ───────────────────────── Server Actions ─────────────────────────

/**
 * Carga el chequeo de hardDeadlines para un proyecto. Lectura — no
 * requiere `requireProjectAccess` (lo deja al adapter de Prisma + RLS),
 * pero se valida `projectId`.
 */
export async function getHardDeadlineCheck(
  projectId: string,
): Promise<SerializableHardDeadlineCheck> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId requerido')

  const baseInput = await loadCpmInputForProject(projectId)
  const meta = await loadProjectMeta(projectId)
  const ext = buildExtendedInput(baseInput, meta.tasks)
  const cpm = computeExtendedCpm(ext)
  if (cpm.warnings.some((w) => w.code === 'CYCLE')) {
    actionError('CYCLE_DETECTED', 'El grafo de dependencias contiene ciclos')
  }
  const result = checkHardDeadlines(cpm, baseInput.calendar)
  return serializeHardDeadlineCheck(result)
}

/**
 * Calcula un plan de leveling y lo devuelve serializado. NO muta BD.
 * El cliente luego invoca `applyLevelingPlan` con los cambios aceptados.
 */
export async function computeLevelingPlan(
  projectId: string,
): Promise<SerializableLevelingPlan> {
  if (!projectId) actionError('INVALID_INPUT', 'projectId requerido')

  const baseInput = await loadCpmInputForProject(projectId)
  const meta = await loadProjectMeta(projectId)
  const ext = buildExtendedInput(baseInput, meta.tasks)
  const cpm = computeExtendedCpm(ext)
  if (cpm.warnings.some((w) => w.code === 'CYCLE')) {
    actionError('CYCLE_DETECTED', 'El grafo de dependencias contiene ciclos')
  }

  // Capacidad uniforme = workdayHours del calendario; cada usuario asignado
  // a alguna tarea entra al map.
  const userIds = Array.from(
    new Set(meta.tasks.map((t) => t.assigneeId).filter((x): x is string => !!x)),
  )
  const capacity = buildUniformCapacity(userIds, meta.workdayHours)

  const plan = levelResources({
    cpm,
    capacityPerDay: capacity,
    calendar: baseInput.calendar,
    defaultDailyEffortHours: meta.workdayHours,
  })

  const tasksById = new Map(meta.tasks.map((t) => [t.id, t]))
  return serializeLevelingPlan(plan, tasksById)
}

/**
 * Aplica un plan de leveling: actualiza `startDate`/`endDate` de cada
 * tarea en el plan dentro de una transaction. Requiere acceso al
 * proyecto. Ignora cambios con `deltaDays = 0`.
 */
export async function applyLevelingPlan(
  rawInput: unknown,
): Promise<{ ok: true; updated: number }> {
  const parsed = applyPlanSchema.safeParse(rawInput)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      `Plan inválido: ${parsed.error.issues[0]?.message ?? 'shape incorrecto'}`,
    )
  }
  const input = parsed.data

  await requireProjectAccess(input.projectId)

  const effective = input.changes.filter((c) => c.deltaDays !== 0)
  if (effective.length === 0) {
    actionError('NO_VIOLATIONS', 'Sin cambios efectivos para aplicar')
  }

  // Validar que todas las tareas pertenecen al proyecto.
  const ids = effective.map((c) => c.taskId)
  const owned = await prisma.task.findMany({
    where: { id: { in: ids }, projectId: input.projectId },
    select: { id: true },
  })
  if (owned.length !== ids.length) {
    actionError('NOT_FOUND', 'Alguna tarea del plan no pertenece al proyecto')
  }

  const updated = await prisma.$transaction(
    effective.map((c) =>
      prisma.task.update({
        where: { id: c.taskId },
        data: {
          startDate: new Date(c.proposedStart),
          endDate: new Date(c.proposedEnd),
        },
        select: { id: true },
      }),
    ),
  )

  invalidateCpmCache(input.projectId)
  revalidatePath('/leveling')
  revalidatePath('/gantt')
  revalidatePath('/list')
  revalidatePath('/workload')

  return { ok: true as const, updated: updated.length }
}

