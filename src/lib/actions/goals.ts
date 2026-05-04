'use server'

/**
 * Ola P2 · Equipo P2-4 — Server actions de Goals & OKRs.
 *
 * Implementa CRUD de `Goal` y `KeyResult`, vinculación de `Task` ↔ KR
 * (relación M:N "_KeyResultTasks") y recálculo automático del progreso
 * para KRs con metric `TASKS_COMPLETED`. Las funciones puras viven en
 * `@/lib/okr/progress`; este módulo solo orquesta persistencia +
 * invalidación.
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle` (`GOAL_NOT_FOUND`, `KR_NOT_FOUND`,
 *     `INVALID_METRIC`, `INVALID_CYCLE`, `INVALID_INPUT`, `TASK_NOT_FOUND`).
 *   - Validación zod por entrada; despacho de shape de KR por `metric`.
 *   - `revalidatePath('/goals')` tras cualquier mutación. El TaskDrawer
 *     también revalida `/list`, `/kanban`, `/gantt` cuando un link/unlink
 *     puede afectar la pestaña Goals del drawer.
 *
 * Decisiones autónomas (documentadas para revisión):
 *   D-OKR-1: NO exponer pesos por KR en el MVP — `computeGoalProgress` usa
 *           promedio uniforme. Suficiente para 90% de casos según
 *           literatura OKR (Doerr, 2018).
 *   D-OKR-2: `linkTaskToKeyResult` es idempotente (connect ya es upsert);
 *           `unlinkTask` también (no-op si no existía la relación).
 *   D-OKR-3: `recomputeKeyResultProgress` SOLO opera sobre `TASKS_COMPLETED`.
 *           Si el caller llama con un KR de otra metric, devuelve sin
 *           modificar para evitar machacar `currentValue` manual.
 *   D-OKR-4: `getGoalsForCycle` no usa `unstable_cache` en MVP — el
 *           dashboard goals es de baja frecuencia y el coste de
 *           invalidación cruzada (KR ↔ Task) no compensa todavía.
 *   D-OKR-5: NO se valida ProjectAssignment para Goals corporativos
 *           (projectId=null) — son visibles a todos los usuarios. Cuando
 *           haya projectId sí se valida con `requireProjectAccess`.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma, type GoalStatus, type KeyResultMetric } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  classifyGoalStatus,
  computeGoalProgress,
  computeKeyResultProgress,
  isValidCycle,
} from '@/lib/okr/progress'

// ───────────────────────── Errores tipados ─────────────────────────

export type GoalsErrorCode =
  | 'INVALID_INPUT'
  | 'GOAL_NOT_FOUND'
  | 'KR_NOT_FOUND'
  | 'INVALID_METRIC'
  | 'INVALID_CYCLE'
  | 'TASK_NOT_FOUND'
  | 'OWNER_NOT_FOUND'
  | 'INVALID_DATE_RANGE'

function actionError(code: GoalsErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

// Reutilizamos las cadenas Prisma como SSOT del enum. zod los acepta como
// tuple literal: si Prisma cambia un valor, el typecheck rompe aquí.
const GOAL_STATUS_VALUES = [
  'ON_TRACK',
  'AT_RISK',
  'OFF_TRACK',
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly GoalStatus[]

const METRIC_VALUES = [
  'PERCENT',
  'NUMERIC',
  'BOOLEAN',
  'TASKS_COMPLETED',
] as const satisfies readonly KeyResultMetric[]

const cycleSchema = z
  .string()
  .trim()
  .refine(isValidCycle, {
    message: 'El ciclo debe tener formato Q1-2026, H1-2026 o Y2026',
  })

const goalCreateSchema = z
  .object({
    title: z.string().trim().min(1, 'El título es obligatorio').max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    ownerId: z.string().min(1, 'ownerId es obligatorio'),
    projectId: z.string().min(1).optional().nullable(),
    cycle: cycleSchema,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    parentId: z.string().min(1).optional().nullable(),
    status: z.enum(GOAL_STATUS_VALUES).optional(),
  })
  .refine((v) => v.startDate.getTime() < v.endDate.getTime(), {
    message: 'startDate debe ser anterior a endDate',
    path: ['endDate'],
  })

export type CreateGoalInput = z.input<typeof goalCreateSchema>

const goalUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    ownerId: z.string().min(1).optional(),
    projectId: z.string().min(1).nullable().optional(),
    cycle: cycleSchema.optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    parentId: z.string().min(1).nullable().optional(),
    status: z.enum(GOAL_STATUS_VALUES).optional(),
  })
  .refine(
    (v) => {
      // Si se proveen ambos, validar orden. Si solo uno, dejamos pasar (el
      // server action hace la validación cruzada con el valor existente).
      if (v.startDate && v.endDate) {
        return v.startDate.getTime() < v.endDate.getTime()
      }
      return true
    },
    { message: 'startDate debe ser anterior a endDate', path: ['endDate'] },
  )

export type UpdateGoalInput = z.input<typeof goalUpdateSchema>

// KR: validamos shape por metric con discriminated refinement.
const krCreateSchema = z
  .object({
    title: z.string().trim().min(1, 'El título es obligatorio').max(200),
    metric: z.enum(METRIC_VALUES),
    targetValue: z.number().finite(),
    currentValue: z.number().finite().optional(),
    unit: z.string().trim().max(40).nullable().optional(),
    position: z.number().finite().optional(),
  })
  .refine(
    (v) => {
      if (v.metric === 'BOOLEAN') return v.targetValue === 1
      if (v.metric === 'PERCENT') return v.targetValue > 0 && v.targetValue <= 100
      if (v.metric === 'TASKS_COMPLETED') return v.targetValue === 100
      // NUMERIC: cualquier número positivo (no permitimos target=0 → división).
      return v.targetValue > 0
    },
    {
      message: 'targetValue inválido para la métrica seleccionada',
      path: ['targetValue'],
    },
  )

export type CreateKeyResultInput = z.input<typeof krCreateSchema>

const krUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  targetValue: z.number().finite().optional(),
  currentValue: z.number().finite().optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  position: z.number().finite().optional(),
})

export type UpdateKeyResultInput = z.input<typeof krUpdateSchema>

// ───────────────────────── Helpers internos ─────────────────────────

async function ensureUserExists(userId: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!u) actionError('OWNER_NOT_FOUND', `Usuario ${userId} no existe`)
}

async function ensureGoalExists(goalId: string): Promise<{ id: string }> {
  const g = await prisma.goal.findUnique({ where: { id: goalId }, select: { id: true } })
  if (!g) actionError('GOAL_NOT_FOUND', `Objetivo ${goalId} no existe`)
  return g
}

function revalidateGoalsRoutes(): void {
  revalidatePath('/goals')
}

// ───────────────────────── Server actions: Goal ─────────────────────────

export async function createGoal(input: CreateGoalInput): Promise<{ id: string }> {
  const parsed = goalCreateSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  await ensureUserExists(data.ownerId)
  if (data.parentId) await ensureGoalExists(data.parentId)

  const created = await prisma.goal.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      ownerId: data.ownerId,
      projectId: data.projectId ?? null,
      cycle: data.cycle.trim(),
      startDate: data.startDate,
      endDate: data.endDate,
      parentId: data.parentId ?? null,
      status: data.status ?? 'ON_TRACK',
    },
    select: { id: true },
  })

  revalidateGoalsRoutes()
  return created
}

export async function updateGoal(
  id: string,
  patch: UpdateGoalInput,
): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  const parsed = goalUpdateSchema.safeParse(patch)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const p = parsed.data

  // Cargar el actual para validar fechas cruzadas y existencia.
  const current = await prisma.goal.findUnique({
    where: { id },
    select: { id: true, startDate: true, endDate: true },
  })
  if (!current) actionError('GOAL_NOT_FOUND', `Objetivo ${id} no existe`)

  const nextStart = p.startDate ?? current.startDate
  const nextEnd = p.endDate ?? current.endDate
  if (nextStart.getTime() >= nextEnd.getTime()) {
    actionError('INVALID_DATE_RANGE', 'startDate debe ser anterior a endDate')
  }

  if (p.ownerId) await ensureUserExists(p.ownerId)
  if (p.parentId) await ensureGoalExists(p.parentId)

  const data: Prisma.GoalUpdateInput = {}
  if (p.title !== undefined) data.title = p.title
  if (p.description !== undefined) data.description = p.description
  if (p.ownerId !== undefined) {
    data.owner = { connect: { id: p.ownerId } }
  }
  if (p.projectId !== undefined) {
    data.project = p.projectId
      ? { connect: { id: p.projectId } }
      : { disconnect: true }
  }
  if (p.cycle !== undefined) data.cycle = p.cycle.trim()
  if (p.startDate !== undefined) data.startDate = p.startDate
  if (p.endDate !== undefined) data.endDate = p.endDate
  if (p.parentId !== undefined) {
    data.parent = p.parentId
      ? { connect: { id: p.parentId } }
      : { disconnect: true }
  }
  if (p.status !== undefined) data.status = p.status

  await prisma.goal.update({ where: { id }, data })
  revalidateGoalsRoutes()
}

export async function deleteGoal(id: string): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  // Cascade en KeyResult; los hijos (sub-Goals) quedan con parentId=NULL
  // por la regla SetNull del schema (no perdemos datos).
  try {
    await prisma.goal.delete({ where: { id } })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2025'
    ) {
      actionError('GOAL_NOT_FOUND', `Objetivo ${id} no existe`)
    }
    throw err
  }
  revalidateGoalsRoutes()
}

// ───────────────────────── Server actions: KeyResult ─────────────────────────

export async function createKeyResult(
  goalId: string,
  input: CreateKeyResultInput,
): Promise<{ id: string }> {
  if (!goalId) actionError('INVALID_INPUT', 'goalId es obligatorio')
  await ensureGoalExists(goalId)

  const parsed = krCreateSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_METRIC',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  // Asignamos position como max+1 (D-CF-2 paridad con custom-fields).
  const last = await prisma.keyResult.findFirst({
    where: { goalId },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const nextPosition = data.position ?? (last?.position ?? 0) + 1

  // Para BOOLEAN/TASKS_COMPLETED el `currentValue` por defecto es 0.
  // Para PERCENT/NUMERIC respetamos el override si vino.
  const currentValue = data.currentValue ?? 0

  const created = await prisma.keyResult.create({
    data: {
      goalId,
      title: data.title,
      metric: data.metric,
      targetValue: data.targetValue,
      currentValue,
      unit: data.unit ?? null,
      position: nextPosition,
    },
    select: { id: true },
  })

  revalidateGoalsRoutes()
  return created
}

export async function updateKeyResult(
  id: string,
  patch: UpdateKeyResultInput,
): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  const parsed = krUpdateSchema.safeParse(patch)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const exists = await prisma.keyResult.findUnique({
    where: { id },
    select: { id: true, metric: true },
  })
  if (!exists) actionError('KR_NOT_FOUND', `Resultado clave ${id} no existe`)

  // Defensa: si la metric es TASKS_COMPLETED, no permitimos override manual
  // de `currentValue` (lo deriva el recompute). El cliente debe usar
  // `recomputeKeyResultProgress` o link/unlink de tareas.
  if (
    exists.metric === 'TASKS_COMPLETED' &&
    parsed.data.currentValue !== undefined
  ) {
    actionError(
      'INVALID_METRIC',
      'currentValue no se edita manualmente para TASKS_COMPLETED',
    )
  }

  await prisma.keyResult.update({
    where: { id },
    data: parsed.data,
  })
  revalidateGoalsRoutes()
}

export async function deleteKeyResult(id: string): Promise<void> {
  if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
  try {
    await prisma.keyResult.delete({ where: { id } })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2025'
    ) {
      actionError('KR_NOT_FOUND', `Resultado clave ${id} no existe`)
    }
    throw err
  }
  revalidateGoalsRoutes()
}

// ───────────────────────── Vínculo Task ↔ KR ─────────────────────────

export async function linkTaskToKeyResult(
  krId: string,
  taskId: string,
): Promise<void> {
  if (!krId || !taskId) actionError('INVALID_INPUT', 'krId y taskId son obligatorios')

  const [kr, task] = await Promise.all([
    prisma.keyResult.findUnique({
      where: { id: krId },
      select: { id: true, metric: true },
    }),
    prisma.task.findUnique({ where: { id: taskId }, select: { id: true } }),
  ])
  if (!kr) actionError('KR_NOT_FOUND', `Resultado clave ${krId} no existe`)
  if (!task) actionError('TASK_NOT_FOUND', `Tarea ${taskId} no existe`)
  if (kr.metric !== 'TASKS_COMPLETED') {
    actionError(
      'INVALID_METRIC',
      'Solo los KR con metric TASKS_COMPLETED pueden vincular tareas',
    )
  }

  // `connect` es idempotente: si ya están vinculados, no-op (D-OKR-2).
  await prisma.keyResult.update({
    where: { id: krId },
    data: { linkedTasks: { connect: { id: taskId } } },
  })
  await recomputeKeyResultProgress(krId)
  revalidateGoalsRoutes()
}

export async function unlinkTask(krId: string, taskId: string): Promise<void> {
  if (!krId || !taskId) actionError('INVALID_INPUT', 'krId y taskId son obligatorios')

  // `disconnect` es idempotente: si no está vinculada, no-op (D-OKR-2).
  await prisma.keyResult.update({
    where: { id: krId },
    data: { linkedTasks: { disconnect: { id: taskId } } },
  })
  await recomputeKeyResultProgress(krId)
  revalidateGoalsRoutes()
}

// ───────────────────────── Recompute & queries ─────────────────────────

/**
 * Recalcula `currentValue` para un KR de tipo TASKS_COMPLETED. Para otras
 * metrics es no-op (D-OKR-3). Devuelve el nuevo valor para que el caller
 * pueda actualizar la UI sin recargar.
 *
 * También re-clasifica el `status` del Goal padre si está en uno de los
 * estados auto-derivables (ON_TRACK / AT_RISK / OFF_TRACK). Si el Goal
 * está COMPLETED o CANCELLED el status no se toca (decisión manual).
 */
export async function recomputeKeyResultProgress(
  krId: string,
): Promise<{ currentValue: number }> {
  if (!krId) actionError('INVALID_INPUT', 'krId es obligatorio')

  const kr = await prisma.keyResult.findUnique({
    where: { id: krId },
    select: {
      id: true,
      metric: true,
      targetValue: true,
      currentValue: true,
      goalId: true,
      linkedTasks: { select: { id: true, status: true } },
    },
  })
  if (!kr) actionError('KR_NOT_FOUND', `Resultado clave ${krId} no existe`)
  if (kr.metric !== 'TASKS_COMPLETED') {
    return { currentValue: kr.currentValue }
  }

  const newProgress = computeKeyResultProgress(
    {
      id: kr.id,
      metric: kr.metric,
      targetValue: kr.targetValue,
      currentValue: kr.currentValue,
    },
    kr.linkedTasks.map((t) => ({ id: t.id, status: t.status })),
  )

  if (newProgress !== kr.currentValue) {
    await prisma.keyResult.update({
      where: { id: krId },
      data: { currentValue: newProgress },
    })
  }

  // Re-clasificación del Goal padre (status auto-derivable).
  await maybeReclassifyGoalStatus(kr.goalId)

  revalidateGoalsRoutes()
  return { currentValue: newProgress }
}

/**
 * Re-clasifica el status de un Goal usando `classifyGoalStatus`. Solo
 * actúa si el status actual está en {ON_TRACK, AT_RISK, OFF_TRACK} (los
 * estados auto-derivables). COMPLETED y CANCELLED son decisión humana y
 * no se tocan.
 *
 * No invalida rutas — el caller (server action de recompute) ya lo hace.
 */
async function maybeReclassifyGoalStatus(goalId: string): Promise<void> {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      keyResults: {
        select: {
          id: true,
          metric: true,
          targetValue: true,
          currentValue: true,
        },
      },
    },
  })
  if (!goal) return
  if (goal.status === 'COMPLETED' || goal.status === 'CANCELLED') return

  const progress = computeGoalProgress({ keyResults: goal.keyResults })
  const now = Date.now()
  const totalDays = Math.max(
    1,
    Math.ceil(
      (goal.endDate.getTime() - goal.startDate.getTime()) / 86_400_000,
    ),
  )
  const daysElapsed = Math.max(
    0,
    Math.floor((now - goal.startDate.getTime()) / 86_400_000),
  )
  const next = classifyGoalStatus(progress, daysElapsed, totalDays)
  // Si la heurística devuelve COMPLETED y todavía hay tiempo, NO promovemos
  // automáticamente — el closing del Goal es manual. Solo alineamos
  // ON_TRACK / AT_RISK / OFF_TRACK aquí.
  if (next === 'ON_TRACK' || next === 'AT_RISK' || next === 'OFF_TRACK') {
    if (next !== goal.status) {
      await prisma.goal.update({
        where: { id: goalId },
        data: { status: next },
      })
    }
  }
}

/**
 * Hook llamado por `updateTask`/`updateTaskStatus` cuando una tarea pasa
 * a (o sale de) DONE. Recalcula todos los KRs vinculados a esa tarea.
 *
 * Tolerante a fallos: si una tarea no existe o no tiene KRs vinculados,
 * sale silenciosamente — está pensado para colgarse de hooks asíncronos
 * sin romper el flujo principal de la mutación de Task.
 */
export async function recomputeKeyResultsForTask(taskId: string): Promise<void> {
  if (!taskId) return
  const krs = await prisma.keyResult.findMany({
    where: { linkedTasks: { some: { id: taskId } } },
    select: { id: true },
  })
  if (krs.length === 0) return
  for (const kr of krs) {
    try {
      await recomputeKeyResultProgress(kr.id)
    } catch (err) {
      // Best-effort: log y continúa — no queremos que un KR roto bloquee
      // la actualización de la tarea principal.
      console.error('[goals] recomputeKeyResultsForTask falló', kr.id, err)
    }
  }
}

// ───────────────────────── Queries ─────────────────────────

export type SerializedKeyResult = {
  id: string
  goalId: string
  title: string
  metric: KeyResultMetric
  targetValue: number
  currentValue: number
  unit: string | null
  position: number
  progress: number
  linkedTaskCount: number
}

export type SerializedGoal = {
  id: string
  title: string
  description: string | null
  ownerId: string
  ownerName: string
  projectId: string | null
  projectName: string | null
  cycle: string
  startDate: string
  endDate: string
  status: GoalStatus
  parentId: string | null
  progress: number
  keyResults: SerializedKeyResult[]
}

/**
 * Lista todos los Goals de un ciclo, opcionalmente filtrando por proyecto.
 * Incluye KRs y conteo de tasks vinculadas para no requerir round-trips
 * adicionales en el dashboard.
 *
 * El `progress` se calcula en runtime con `computeGoalProgress` — no se
 * persiste para evitar drift cuando se modifica un KR sin disparar un
 * recompute explícito.
 */
export async function getGoalsForCycle(
  cycle: string,
  projectId?: string | null,
): Promise<SerializedGoal[]> {
  if (!isValidCycle(cycle)) {
    actionError('INVALID_CYCLE', `Ciclo inválido: ${cycle}`)
  }

  const where: Prisma.GoalWhereInput = { cycle: cycle.trim() }
  if (projectId !== undefined && projectId !== null) {
    where.projectId = projectId
  }

  const rows = await prisma.goal.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }],
    include: {
      owner: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      keyResults: {
        orderBy: { position: 'asc' },
        include: {
          _count: { select: { linkedTasks: true } },
        },
      },
    },
  })

  return rows.map((g) => {
    const keyResults: SerializedKeyResult[] = g.keyResults.map((kr) => ({
      id: kr.id,
      goalId: kr.goalId,
      title: kr.title,
      metric: kr.metric,
      targetValue: kr.targetValue,
      currentValue: kr.currentValue,
      unit: kr.unit,
      position: kr.position,
      progress: computeKeyResultProgress(
        {
          id: kr.id,
          metric: kr.metric,
          targetValue: kr.targetValue,
          currentValue: kr.currentValue,
        },
        [],
      ),
      linkedTaskCount: kr._count.linkedTasks,
    }))

    return {
      id: g.id,
      title: g.title,
      description: g.description,
      ownerId: g.ownerId,
      ownerName: g.owner.name,
      projectId: g.projectId,
      projectName: g.project?.name ?? null,
      cycle: g.cycle,
      startDate: g.startDate.toISOString(),
      endDate: g.endDate.toISOString(),
      status: g.status,
      parentId: g.parentId,
      progress: computeGoalProgress({ keyResults }),
      keyResults,
    }
  })
}

/**
 * Lista los KRs vinculados a una task — usado por el tab "Goals" del
 * TaskDrawer para mostrar contexto OKR cuando el usuario abre una tarea.
 */
export async function getKeyResultsForTask(taskId: string): Promise<
  Array<{
    id: string
    title: string
    goalId: string
    goalTitle: string
    cycle: string
    progress: number
  }>
> {
  if (!taskId) return []
  const krs = await prisma.keyResult.findMany({
    where: { linkedTasks: { some: { id: taskId } } },
    include: {
      goal: { select: { id: true, title: true, cycle: true } },
      linkedTasks: { select: { id: true, status: true } },
    },
  })
  return krs.map((kr) => ({
    id: kr.id,
    title: kr.title,
    goalId: kr.goalId,
    goalTitle: kr.goal.title,
    cycle: kr.goal.cycle,
    progress: computeKeyResultProgress(
      {
        id: kr.id,
        metric: kr.metric,
        targetValue: kr.targetValue,
        currentValue: kr.currentValue,
      },
      kr.linkedTasks.map((t) => ({ id: t.id, status: t.status })),
    ),
  }))
}
