'use server'

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'

// =============================================
// COLABORADORES Y URL DE REFERENCIA (Sprint 4)
// =============================================
//
// Convenciones compartidas con `actions.ts`:
//   - Errores tipados con prefijo en corchetes: `[INVALID_INPUT]`,
//     `[NOT_FOUND]`, `[FORBIDDEN]`, `[CONFLICT]`. El cliente puede hacer
//     match si necesita comportarse distinto, y el toast se queda con el
//     mensaje legible que sigue al prefijo.
//   - Hardcode SUPER_ADMIN mientras no exista sesión real (mismo hack que
//     `updateTask`); aceptamos `currentUserRoles` desde el cliente para que
//     el switch a auth real sea simétrico.
//   - Revalidación: las mismas vistas que `revalidateTaskViews` en
//     `actions.ts`. Duplicamos la lista para no introducir un import
//     circular ("use server" → "use server").

const TASK_VIEW_PATHS = [
  '/list',
  '/kanban',
  '/gantt',
  '/table',
  '/workload',
  '/mindmaps',
  '/dashboards',
  '/brain',
] as const

function revalidateTaskViews() {
  for (const p of TASK_VIEW_PATHS) revalidatePath(p)
}

/**
 * Añade un colaborador a la tarea. Idempotente: si ya existe la fila no
 * lanza error (no-op silencioso). Rechaza añadir al `assigneeId` actual
 * porque el responsable principal ya está cubierto por la relación 1:1
 * y duplicar destinatarios en notificaciones es ruido.
 */
export async function addTaskCollaborator(
  taskId: string,
  userId: string,
  currentUserId?: string | null,
  currentUserRoles?: string[],
): Promise<{ taskId: string; userId: string }> {
  if (!taskId || !userId) {
    throw new Error('[INVALID_INPUT] taskId y userId son requeridos')
  }
  // Hook futuro: validar permisos sobre la tarea (asignación de proyecto).
  // Por ahora aceptamos siempre si llega el contrato, igual que `updateTask`.
  void currentUserId
  void currentUserRoles

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assigneeId: true },
  })
  if (!task) throw new Error('[NOT_FOUND] tarea no encontrada')
  if (task.assigneeId === userId) {
    throw new Error(
      '[CONFLICT] el usuario ya es el responsable principal de la tarea',
    )
  }

  // Upsert: idempotente ante doble click o reintentos del cliente.
  await prisma.taskCollaborator.upsert({
    where: { taskId_userId: { taskId, userId } },
    update: {},
    create: { taskId, userId },
  })

  revalidateTaskViews()
  return { taskId, userId }
}

/**
 * Quita un colaborador. No falla si la fila no existe — el cliente puede
 * llamar idempotentemente cuando deshace una acción local.
 */
export async function removeTaskCollaborator(
  taskId: string,
  userId: string,
  currentUserId?: string | null,
  currentUserRoles?: string[],
): Promise<{ taskId: string; userId: string }> {
  if (!taskId || !userId) {
    throw new Error('[INVALID_INPUT] taskId y userId son requeridos')
  }
  void currentUserId
  void currentUserRoles

  await prisma.taskCollaborator.deleteMany({
    where: { taskId, userId },
  })

  revalidateTaskViews()
  return { taskId, userId }
}

/**
 * Valida y normaliza una URL antes de persistir. Acepta `null`/`''`
 * para limpiar el campo. Rechaza protocolos distintos a http/https.
 */
function normalizeReferenceUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('[INVALID_INPUT] URL inválida')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('[INVALID_INPUT] solo se aceptan URLs http(s)')
  }
  return parsed.toString()
}

/**
 * Actualiza la URL de referencia de una tarea. Crea entrada de
 * `TaskHistory` para auditoría (campo `referenceUrl`).
 */
export async function updateTaskReferenceUrl(
  taskId: string,
  url: string | null,
  currentUserId?: string | null,
  currentUserRoles?: string[],
): Promise<{ id: string; referenceUrl: string | null }> {
  if (!taskId) throw new Error('[INVALID_INPUT] taskId es requerido')
  void currentUserRoles

  const next = normalizeReferenceUrl(url)

  const current = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, referenceUrl: true },
  })
  if (!current) throw new Error('[NOT_FOUND] tarea no encontrada')

  // No-op: evita escribir history y revalidar si no cambió.
  if ((current.referenceUrl ?? null) === next) {
    return { id: current.id, referenceUrl: current.referenceUrl ?? null }
  }

  const [updated] = await prisma.$transaction([
    prisma.task.update({
      where: { id: taskId },
      data: { referenceUrl: next },
      select: { id: true, referenceUrl: true },
    }),
    prisma.taskHistory.create({
      data: {
        taskId,
        field: 'referenceUrl',
        oldValue: current.referenceUrl ?? '',
        newValue: next ?? '',
        userId: currentUserId || null,
      },
    }),
  ])

  revalidateTaskViews()
  return updated
}
