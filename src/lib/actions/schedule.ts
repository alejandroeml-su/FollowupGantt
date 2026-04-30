'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'
import { validateScheduledChange } from '@/lib/scheduling/validate'

// Ver ADR-001 y patrón de errores en `reorder.ts`
export type ScheduleErrorCode =
  | 'INVALID_RANGE'
  | 'NOT_FOUND'
  | 'DEPENDENCY_VIOLATION'
  | 'NEGATIVE_FLOAT'
  | 'CYCLE_DETECTED'

function actionError(code: ScheduleErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

const MS_PER_DAY = 86_400_000

function diffDaysUTC(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
      Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) /
      MS_PER_DAY,
  )
}

function revalidateAllBoards() {
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
  revalidatePath('/workload')
}

/**
 * Persiste startDate / endDate tras un drag/resize del Gantt.
 * Valida que start <= end y (si aplica) no rompa dependencias FINISH_TO_START
 * con predecesores.
 */
export async function updateTaskDates(
  id: string,
  startDate: Date | null,
  endDate: Date | null,
) {
  if (!id) actionError('NOT_FOUND', 'id requerido')

  if (startDate && endDate && startDate > endDate) {
    actionError('INVALID_RANGE', 'startDate debe ser ≤ endDate')
  }

  // Validación ligera de dependencia FS: si la tarea tiene predecesores
  // FINISH_TO_START, startDate no puede ser anterior al endDate del predecesor.
  if (startDate) {
    const preds = await prisma.taskDependency.findMany({
      where: { successorId: id, type: 'FINISH_TO_START' },
      include: { predecessor: { select: { endDate: true, title: true } } },
    })
    for (const d of preds) {
      const pEnd = d.predecessor.endDate
      if (pEnd && startDate < pEnd) {
        actionError(
          'DEPENDENCY_VIOLATION',
          `"${d.predecessor.title}" termina el ${pEnd.toISOString().slice(0, 10)}.`,
        )
      }
    }
  }

  // HU-1.5 · Validación CPM pre-commit: simular el cambio en memoria y
  // rechazar si genera tareas con holgura negativa. Se hace después del
  // check FS clásico (más barato) y antes de tocar BD.
  const taskMeta = await prisma.task.findUnique({
    where: { id },
    select: { projectId: true, isMilestone: true },
  })
  if (!taskMeta) actionError('NOT_FOUND', 'tarea inexistente')
  await validateScheduledChangeForTaskDates(
    id,
    taskMeta.projectId,
    !!taskMeta.isMilestone,
    startDate,
    endDate,
  )

  const updated = await prisma.task.update({
    where: { id },
    data: {
      ...(startDate !== undefined && { startDate }),
      ...(endDate !== undefined && { endDate }),
    },
    select: { projectId: true },
  })

  invalidateCpmCache(updated.projectId)
  revalidateAllBoards()
  return { ok: true as const }
}

/**
 * Llama a `validateScheduledChange` mapeando los nuevos `startDate`/`endDate`
 * al override de CpmInput (duration + earliestStartConstraint relativos al
 * projectStart calculado por `loadCpmInputForProject`). Si la simulación
 * detecta slack negativo o ciclos, lanza `[NEGATIVE_FLOAT]` /
 * `[CYCLE_DETECTED]`.
 *
 * Se exporta vía wrapper en lugar de inline para mantener `updateTaskDates`
 * legible y permitir reuso desde `shiftTaskDates` (que delega).
 */
async function validateScheduledChangeForTaskDates(
  taskId: string,
  projectId: string | null,
  isMilestone: boolean,
  startDate: Date | null,
  endDate: Date | null,
): Promise<void> {
  if (!projectId) return

  // Replica la heurística de `prismaAdapter.loadCpmInputForProject` para
  // calcular la nueva `duration`. Si la mutación deja la tarea sin fechas,
  // no podemos estimarla → no validamos (caso degenerado, queda al CPM
  // posterior reportarlo como ORPHAN si aplica).
  let duration: number | undefined
  if (isMilestone) {
    duration = 0
  } else if (startDate && endDate) {
    duration = Math.max(1, diffDaysUTC(startDate, endDate))
  }

  // earliestStartConstraint depende del projectStart, que la simulación
  // recalcula al cargar el grafo. Pasamos el delta real respecto a la
  // fecha mínima del proyecto: dejamos que `applyOverrideToCpmInput`
  // sobrescriba sin tocar `projectStart` (la nueva fecha podría correr el
  // origen del proyecto, pero CPM trabaja en deltas; un origen ligeramente
  // distinto no cambia los floats).
  await validateScheduledChange(projectId, {
    taskUpdates: [
      {
        id: taskId,
        ...(duration !== undefined ? { duration } : {}),
        ...(startDate ? { startDate } : {}),
      },
    ],
  })
}

/**
 * Atajo: desplaza startDate y endDate en la misma cantidad de días.
 * Útil para drag de cuerpo de la barra.
 */
export async function shiftTaskDates(id: string, deltaDays: number) {
  if (!Number.isFinite(deltaDays) || deltaDays === 0) return { ok: true as const }
  const t = await prisma.task.findUnique({
    where: { id },
    select: { startDate: true, endDate: true },
  })
  if (!t) actionError('NOT_FOUND', 'tarea inexistente')

  const next = {
    startDate: t.startDate ? addDays(t.startDate, deltaDays) : null,
    endDate: t.endDate ? addDays(t.endDate, deltaDays) : null,
  }
  return updateTaskDates(id, next.startDate, next.endDate)
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}
