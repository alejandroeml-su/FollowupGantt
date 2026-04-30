'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'

// Ver ADR-001 y patrón de errores en `reorder.ts`
export type ScheduleErrorCode =
  | 'INVALID_RANGE'
  | 'NOT_FOUND'
  | 'DEPENDENCY_VIOLATION'

function actionError(code: ScheduleErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
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
