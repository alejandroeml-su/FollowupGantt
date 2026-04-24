'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

// Códigos de error serializables para que el cliente adapte la UI.
// Los errores de action en Next.js se propagan por su `.message`, así que
// incluimos el código entre corchetes al inicio para parsing sencillo.
export type ReorderErrorCode =
  | 'WIP_LIMIT_EXCEEDED'
  | 'INVALID_TARGET'
  | 'NOT_FOUND'

function actionError(code: ReorderErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ADR-001 · Fractional indexing.
// Calcula una posición entre (before, after). Si alguno falta, usa ±1.
function computePosition(before: number | null, after: number | null): number {
  if (before == null && after == null) return 1
  if (before == null && after != null) return after - 1
  if (before != null && after == null) return before + 1
  return ((before as number) + (after as number)) / 2
}

async function getPositionOf(id: string | null): Promise<number | null> {
  if (!id) return null
  const t = await prisma.task.findUnique({ where: { id }, select: { position: true } })
  return t?.position ?? null
}

function revalidateAllBoards() {
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
  revalidatePath('/workload')
}

export async function reorderTask(
  taskId: string,
  beforeId: string | null,
  afterId: string | null,
) {
  if (!taskId) throw new Error('taskId requerido')

  const [beforePos, afterPos] = await Promise.all([
    getPositionOf(beforeId),
    getPositionOf(afterId),
  ])

  const position = computePosition(beforePos, afterPos)

  await prisma.task.update({
    where: { id: taskId },
    data: { position },
  })

  revalidateAllBoards()
  return { ok: true as const, position }
}

/**
 * Mueve una tarea a una columna. Si el status de destino recibe `wipLimit`
 * (la UI actual del Kanban usa columnas basadas en TaskStatus), se aplica
 * WIP limit en el servidor antes del update. Devuelve error tipado
 * `[WIP_LIMIT_EXCEEDED]` si el destino ya está al tope.
 */
export async function moveTaskToColumn(
  taskId: string,
  columnId: string | null,
  beforeId: string | null = null,
  afterId: string | null = null,
  opts: { wipLimit?: number | null; enforceStatus?: string | null } = {},
) {
  if (!taskId) actionError('INVALID_TARGET', 'taskId requerido')

  // WIP enforcement: si la columna tiene wipLimit y el status objetivo está
  // ya al tope, rechazar antes de tocar DB.
  if (opts.wipLimit != null && opts.enforceStatus) {
    const count = await prisma.task.count({
      where: {
        status: opts.enforceStatus as never,
        archivedAt: null,
        id: { not: taskId },
      },
    })
    if (count >= opts.wipLimit) {
      actionError(
        'WIP_LIMIT_EXCEEDED',
        `La columna ${opts.enforceStatus} ya tiene ${count}/${opts.wipLimit}.`,
      )
    }
  }

  const [beforePos, afterPos] = await Promise.all([
    getPositionOf(beforeId),
    getPositionOf(afterId),
  ])
  const position = computePosition(beforePos, afterPos)

  await prisma.task.update({
    where: { id: taskId },
    data: { columnId, position },
  })

  revalidateAllBoards()
  return { ok: true as const, position }
}

/**
 * Variante en lote respetando WIP: aplica una única validación por el tamaño
 * total del grupo. Si no cabe el lote completo, rechaza todo el movimiento.
 */
export async function bulkMoveTasksWithStatus(
  ids: string[],
  status: string,
  columnId: string | null,
  wipLimit: number | null,
) {
  if (!ids.length) return { ok: true as const, updated: 0 }

  if (wipLimit != null) {
    const count = await prisma.task.count({
      where: {
        status: status as never,
        archivedAt: null,
        id: { notIn: ids },
      },
    })
    if (count + ids.length > wipLimit) {
      actionError(
        'WIP_LIMIT_EXCEEDED',
        `No caben ${ids.length} tareas en ${status} (${count}/${wipLimit}).`,
      )
    }
  }

  const r = await prisma.task.updateMany({
    where: { id: { in: ids } },
    data: { columnId, status: status as never },
  })

  revalidateAllBoards()
  return { ok: true as const, updated: r.count }
}

export async function moveTaskToParent(
  taskId: string,
  newParentId: string | null,
) {
  if (!taskId) throw new Error('taskId requerido')
  if (newParentId && newParentId === taskId)
    throw new Error('Una tarea no puede ser su propio padre')

  await prisma.task.update({
    where: { id: taskId },
    data: { parentId: newParentId },
  })

  revalidateAllBoards()
  return { ok: true as const }
}

export async function bulkMoveTasksToColumn(
  ids: string[],
  columnId: string | null,
) {
  if (!ids.length) return { ok: true as const, updated: 0 }

  const result = await prisma.task.updateMany({
    where: { id: { in: ids } },
    data: { columnId },
  })

  revalidateAllBoards()
  return { ok: true as const, updated: result.count }
}

export async function archiveTask(id: string) {
  if (!id) throw new Error('id requerido')
  await prisma.task.update({
    where: { id },
    data: { archivedAt: new Date() },
  })
  revalidateAllBoards()
  return { ok: true as const }
}

export async function unarchiveTask(id: string) {
  if (!id) throw new Error('id requerido')
  await prisma.task.update({
    where: { id },
    data: { archivedAt: null },
  })
  revalidateAllBoards()
  return { ok: true as const }
}

export async function duplicateTask(id: string) {
  const src = await prisma.task.findUnique({ where: { id } })
  if (!src) throw new Error('Tarea no encontrada')

  const copy = await prisma.task.create({
    data: {
      title: `${src.title} (copia)`,
      description: src.description,
      type: src.type,
      status: src.status,
      priority: src.priority,
      parentId: src.parentId,
      projectId: src.projectId,
      phaseId: src.phaseId,
      sprintId: src.sprintId,
      columnId: src.columnId,
      assigneeId: src.assigneeId,
      startDate: src.startDate,
      endDate: src.endDate,
      isMilestone: src.isMilestone,
      tags: src.tags,
      position: src.position + 0.0001,
    },
  })

  revalidateAllBoards()
  return { id: copy.id }
}

export async function bulkArchive(ids: string[]) {
  if (!ids.length) return { ok: true as const, updated: 0 }
  const r = await prisma.task.updateMany({
    where: { id: { in: ids } },
    data: { archivedAt: new Date() },
  })
  revalidateAllBoards()
  return { ok: true as const, updated: r.count }
}

export async function bulkDelete(ids: string[]) {
  if (!ids.length) return { ok: true as const, deleted: 0 }
  const r = await prisma.task.deleteMany({
    where: { id: { in: ids } },
  })
  revalidateAllBoards()
  return { ok: true as const, deleted: r.count }
}
