'use server'

/**
 * Wave P9 · Agile Maturity (HU-9.6) — Backlog priorizable.
 *
 * Server actions para la vista `/projects/{id}/backlog`:
 *   - listBacklogForProject   → Stories sin sprint del proyecto, ordenadas
 *                                por priority (CRITICAL > HIGH > MEDIUM >
 *                                LOW) y luego por position.
 *   - reorderBacklog          → reordena positions tras drag-drop.
 *   - bulkAssignToSprint      → asigna múltiples Tasks a un Sprint.
 *   - bulkRemoveFromSprint    → desasigna del sprint (volver al backlog).
 *
 * Nota: a diferencia del Kanban (`reorderTask` por par before/after),
 * el Backlog usa un único array linear → `reorderBacklog(orderedIds)`
 * recibe el orden completo y persiste positions en una sola transacción.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'

export type BacklogTask = {
  id: string
  mnemonic: string | null
  title: string
  description: string | null
  status: string
  priority: string
  type: string
  storyPoints: number | null
  position: number
  assignee: { id: string; name: string } | null
  epic: { id: string; name: string; color: string } | null
}

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

function revalidateBacklogViews(projectId: string) {
  revalidatePath(`/projects/${projectId}/backlog`)
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/table')
  revalidatePath('/gantt')
}

/**
 * Lista las Tasks que conforman el backlog del proyecto:
 *   - sprintId IS NULL (no asignadas a sprint)
 *   - parentId IS NULL (sólo raíces; las subtareas viven con su padre)
 *   - archivedAt IS NULL
 *   - status != DONE (las completadas no se muestran en backlog)
 *
 * Ordenadas por priority y luego por position.
 */
export async function listBacklogForProject(projectId: string): Promise<BacklogTask[]> {
  if (!projectId) return []
  const rows = await prisma.task.findMany({
    where: {
      projectId,
      sprintId: null,
      parentId: null,
      archivedAt: null,
      status: { not: 'DONE' },
    },
    select: {
      id: true,
      mnemonic: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      type: true,
      storyPoints: true,
      position: true,
      assignee: { select: { id: true, name: true } },
      epic: { select: { id: true, name: true, color: true } },
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })

  // Sort por priority en JS porque Prisma no permite ordenar por map.
  return rows.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99
    const pb = PRIORITY_ORDER[b.priority] ?? 99
    if (pa !== pb) return pa - pb
    return a.position - b.position
  })
}

/**
 * Reordena el backlog persistiendo la nueva `position` de cada Task.
 * Recibe el array completo en el orden deseado.
 *
 * Implementación: position = index * 1000 (deja gaps para futuros drops
 * sin necesidad de reorganizar la tabla completa).
 */
export async function reorderBacklog(input: {
  projectId: string
  orderedTaskIds: string[]
}): Promise<{ ok: true }> {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  if (!Array.isArray(input.orderedTaskIds)) {
    throw new Error('[INVALID_INPUT] orderedTaskIds debe ser array')
  }

  // Validar que todas las Tasks pertenezcan al proyecto (defensa-en-profundidad).
  if (input.orderedTaskIds.length > 0) {
    const valid = await prisma.task.count({
      where: { id: { in: input.orderedTaskIds }, projectId: input.projectId },
    })
    if (valid !== input.orderedTaskIds.length) {
      throw new Error('[INVALID_INPUT] alguna Task no pertenece al proyecto')
    }
  }

  // Update batch en una sola transacción.
  await prisma.$transaction(
    input.orderedTaskIds.map((id, idx) =>
      prisma.task.update({
        where: { id },
        data: { position: (idx + 1) * 1000 },
      }),
    ),
  )

  revalidateBacklogViews(input.projectId)
  return { ok: true }
}

/**
 * Asigna en lote N tasks a un Sprint. Si `sprintId === null`, las quita
 * del sprint (vuelven al backlog). Valida que el Sprint pertenezca al
 * mismo proyecto que las Tasks.
 */
export async function bulkAssignToSprint(input: {
  taskIds: string[]
  sprintId: string | null
}): Promise<{ ok: true; count: number }> {
  if (!Array.isArray(input.taskIds) || input.taskIds.length === 0) {
    throw new Error('[INVALID_INPUT] taskIds debe ser array no vacío')
  }

  // Validar coherencia: todas las Tasks del mismo proyecto, y el Sprint
  // (si se asigna) pertenece a ese proyecto.
  const tasks = await prisma.task.findMany({
    where: { id: { in: input.taskIds } },
    select: { id: true, projectId: true },
  })
  if (tasks.length !== input.taskIds.length) {
    throw new Error('[NOT_FOUND] alguna task no existe')
  }
  const projectIds = new Set(tasks.map((t) => t.projectId))
  if (projectIds.size !== 1) {
    throw new Error(
      '[INVALID_ASSIGNMENT] todas las tareas deben pertenecer al mismo proyecto',
    )
  }
  const projectId = [...projectIds][0]

  if (input.sprintId) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: input.sprintId },
      select: { projectId: true },
    })
    if (!sprint) throw new Error('[NOT_FOUND] sprint no existe')
    if (sprint.projectId !== projectId) {
      throw new Error(
        '[INVALID_ASSIGNMENT] el sprint pertenece a otro proyecto que las tasks',
      )
    }
  }

  const result = await prisma.task.updateMany({
    where: { id: { in: input.taskIds } },
    data: { sprintId: input.sprintId },
  })

  await recordAuditEventSafe({
    action: input.sprintId ? 'task.sprint_assigned' : 'task.sprint_unassigned',
    entityType: 'task',
    entityId: input.taskIds.join(','),
    after: { sprintId: input.sprintId, count: result.count },
  })

  revalidateBacklogViews(projectId)
  return { ok: true, count: result.count }
}
