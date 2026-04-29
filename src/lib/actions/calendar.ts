'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import type { Priority, TaskType } from '@prisma/client'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'

// Patrón de errores tipados (alineado con reorder.ts / schedule.ts):
//   throw new Error(`[CODE] detalle`)  → el cliente parsea /^\[([A-Z_]+)\]\s*(.+)$/
type CalendarErrorCode =
  | 'INVALID_TARGET'
  | 'NOT_FOUND'
  | 'INVALID_RANGE'
  | 'FORBIDDEN'
function actionError(code: CalendarErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

function revalidateAllBoards() {
  revalidatePath('/calendar')
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
  revalidatePath('/workload')
  revalidatePath('/dashboards')
}

// Lista de roles que permiten crear tareas en cualquier proyecto sin
// necesidad de asignación explícita. Alineado con `updateTask`.
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN'])

/**
 * Quick-create desde el calendario. Crea una tarea de 1 día (start=end=date)
 * con los mínimos campos: título, proyecto, prioridad. Genera mnemónico
 * consistente con la convención del equipo (4 letras del proyecto + count+1).
 *
 * Control de acceso (BLOCKER-2 · QAF):
 *   - `userRoles` = JSON array de roles del usuario que dispara la acción.
 *   - Si incluye ADMIN/SUPER_ADMIN → bypass total.
 *   - En otro caso, `userId` debe estar asignado al proyecto (ProjectAssignment)
 *     o la acción es rechazada con [FORBIDDEN].
 */
export async function quickCreateTaskForDate(input: {
  title: string
  projectId: string
  date: string // ISO YYYY-MM-DD
  priority?: string
  isMilestone?: boolean
  assigneeId?: string | null
  userId?: string | null
  userRoles?: string[]
}) {
  const title = input.title.trim()
  if (!title) actionError('INVALID_TARGET', 'título requerido')
  if (!input.projectId) actionError('INVALID_TARGET', 'projectId requerido')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date))
    actionError('INVALID_RANGE', 'fecha debe ser YYYY-MM-DD')

  // ─── RBAC ───────────────────────────────────────────────────────
  const isAdmin = (input.userRoles ?? []).some((r) => ADMIN_ROLES.has(r))
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      name: true,
      assignments: { select: { userId: true } },
    },
  })
  if (!project) actionError('NOT_FOUND', 'proyecto no existe')

  if (!isAdmin) {
    if (!input.userId)
      actionError('FORBIDDEN', 'usuario no autenticado')
    const isAssigned = project.assignments.some(
      (a) => a.userId === input.userId,
    )
    if (!isAssigned)
      actionError(
        'FORBIDDEN',
        'No tienes permisos para crear tareas en este proyecto. Debes estar asignado al mismo.',
      )
  }
  // ────────────────────────────────────────────────────────────────

  const prefix =
    project.name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .substring(0, 4)
      .toUpperCase() || 'TASK'
  const count = await prisma.task.count({ where: { projectId: input.projectId } })
  const mnemonic = `${prefix}-${count + 1}`

  const day = new Date(`${input.date}T00:00:00.000Z`)

  const task = await prisma.task.create({
    data: {
      title,
      mnemonic,
      projectId: input.projectId,
      status: 'TODO',
      priority: (input.priority as Priority) ?? 'MEDIUM',
      type: 'AGILE_STORY' as TaskType,
      startDate: day,
      endDate: day,
      isMilestone: !!input.isMilestone,
      assigneeId: input.assigneeId || null,
    },
  })

  invalidateCpmCache(input.projectId)
  revalidateAllBoards()
  return { ok: true as const, id: task.id, mnemonic }
}
