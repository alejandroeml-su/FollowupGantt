import type { TaskStatus } from '@prisma/client'

/**
 * Mapeo canónico status → progress %. Aplica a tareas y subtareas
 * (request Edwin 2026-05-06): cambiar el status debe reflejar el
 * avance esperado para que las barras y rollups no queden inconsistentes
 * con el estado del trabajo.
 *
 * Convención discutida:
 *   TODO        →   0%
 *   IN_PROGRESS →  50%
 *   REVIEW      →  75%
 *   DONE        → 100%
 *
 * Vive en este archivo (sin `'use server'`) porque Turbopack en Next.js 16
 * sólo permite que archivos con `'use server'` exporten funciones async.
 * Antes vivía en `src/lib/actions.ts` y rompía el build con
 * `A "use server" file can only export async functions, found object`
 * al intentar pre-render de cualquier page que (transitivamente)
 * importara `actions.ts` durante "Collecting page data".
 */
export const STATUS_PROGRESS_MAP: Record<TaskStatus, number> = {
  TODO: 0,
  IN_PROGRESS: 50,
  REVIEW: 75,
  DONE: 100,
}

/**
 * Decide el `progress` final que debería tener una tarea cuando
 * cambia su `status`. Política:
 *   - Estados terminales (DONE/TODO): forzar 100/0 sin importar lo manual.
 *   - Intermedios (IN_PROGRESS/REVIEW): respetar progreso manual mayor
 *     al canónico (no bajar 65% a 50%); subir si es menor.
 *
 * Helper puro, idempotente — testeable sin tocar BD.
 */
export function nextProgressForStatus(
  newStatus: TaskStatus,
  currentProgress: number,
): number {
  const target = STATUS_PROGRESS_MAP[newStatus] ?? 0
  if (newStatus === 'DONE' || newStatus === 'TODO') return target
  return Math.max(currentProgress, target)
}
