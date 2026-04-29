/**
 * HU-2.1 · Helper de invalidación del cache CPM.
 *
 * Toda server action que mute `Task` o `TaskDependency` debe llamar a
 * `invalidateCpmCache(projectId)` justo después del commit en BD para
 * que el siguiente render del Gantt recompute el grafo crítico.
 *
 * Si la mutación afecta a varios proyectos (caso raro: mover una tarea
 * entre proyectos), invalidar ambos.
 *
 * Nota Next 16: `revalidateTag(tag, profile)` requiere el 2º argumento.
 * Usamos `'max'` (stale-while-revalidate, recomendado por la doc) para
 * que el render actual del Gantt no quede bloqueado mientras el CPM se
 * recomputa en background.
 */

import { revalidateTag } from 'next/cache'

const CPM_REVALIDATE_PROFILE = 'max'

export function invalidateCpmCache(projectId: string | null | undefined): void {
  if (!projectId) return
  revalidateTag(`cpm:${projectId}`, CPM_REVALIDATE_PROFILE)
}

/**
 * Invalida varios proyectos en una sola llamada — cómodo cuando una
 * acción puede afectar a >1 grafo (ej. bulk move entre proyectos).
 */
export function invalidateCpmCaches(projectIds: Iterable<string>): void {
  const seen = new Set<string>()
  for (const pid of projectIds) {
    if (!pid || seen.has(pid)) continue
    seen.add(pid)
    revalidateTag(`cpm:${pid}`, CPM_REVALIDATE_PROFILE)
  }
}
