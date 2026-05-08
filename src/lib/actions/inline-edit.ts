'use server'

/**
 * Wave P9 follow-up — Inline edit actions para la vista lista.
 *
 * Edwin pidió que ASIGNADO, FECHA LÍMITE y PRIORIDAD sean editables
 * directamente desde la fila de `/list` con dropdown searchable, date
 * picker y dropdown respectivamente. Estos servers actions cubren
 * el persistir el cambio.
 *
 * Patrón consistente con `updateTaskStatus` (legacy actions.ts):
 *   · Errores tipados [CODE]
 *   · revalidatePath de /list /kanban /table /gantt /calendar
 *   · recordAuditEventSafe del cambio
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'

function revalidateTaskViews() {
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/table')
  revalidatePath('/gantt')
  revalidatePath('/calendar')
}

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
type ValidPriority = (typeof VALID_PRIORITIES)[number]

/** Cambia el assignee de una task. Pasar `null` para desasignar. */
export async function setTaskAssignee(
  taskId: string,
  assigneeId: string | null,
): Promise<{ ok: true }> {
  if (!taskId) throw new Error('[INVALID_INPUT] taskId requerido')

  const before = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assigneeId: true },
  })
  if (!before) throw new Error('[NOT_FOUND] task no existe')

  if (assigneeId) {
    const user = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: { id: true },
    })
    if (!user) throw new Error('[NOT_FOUND] usuario no existe')
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { assigneeId: assigneeId ?? null },
  })

  await recordAuditEventSafe({
    action: 'task.updated',
    entityType: 'task',
    entityId: taskId,
    before: { assigneeId: before.assigneeId },
    after: { assigneeId },
  })

  revalidateTaskViews()
  return { ok: true }
}

/** Cambia la priority de una task. */
export async function setTaskPriority(
  taskId: string,
  priority: ValidPriority,
): Promise<{ ok: true }> {
  if (!taskId) throw new Error('[INVALID_INPUT] taskId requerido')
  if (!VALID_PRIORITIES.includes(priority)) {
    throw new Error(`[INVALID_INPUT] priority inválida: ${priority}`)
  }

  const before = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, priority: true },
  })
  if (!before) throw new Error('[NOT_FOUND] task no existe')

  await prisma.task.update({
    where: { id: taskId },
    data: { priority },
  })

  await recordAuditEventSafe({
    action: 'task.updated',
    entityType: 'task',
    entityId: taskId,
    before: { priority: before.priority },
    after: { priority },
  })

  revalidateTaskViews()
  return { ok: true }
}

/**
 * Cambia la fecha límite (endDate) de una task. Pasar `null` para borrar.
 * Format aceptado: ISO date string (YYYY-MM-DD).
 */
export async function setTaskEndDate(
  taskId: string,
  endDate: string | null,
): Promise<{ ok: true }> {
  if (!taskId) throw new Error('[INVALID_INPUT] taskId requerido')

  const before = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, endDate: true },
  })
  if (!before) throw new Error('[NOT_FOUND] task no existe')

  let parsed: Date | null = null
  if (endDate) {
    const d = new Date(endDate)
    if (Number.isNaN(d.getTime())) {
      throw new Error('[INVALID_INPUT] fecha inválida')
    }
    d.setUTCHours(0, 0, 0, 0)
    parsed = d
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { endDate: parsed },
  })

  await recordAuditEventSafe({
    action: 'task.updated',
    entityType: 'task',
    entityId: taskId,
    before: { endDate: before.endDate?.toISOString() ?? null },
    after: { endDate: parsed?.toISOString() ?? null },
  })

  revalidateTaskViews()
  return { ok: true }
}
