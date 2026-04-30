/**
 * HU-2.1 · Cache server-side para CPM por proyecto.
 *
 * Envuelve `loadCpmInputForProject` + `computeCpm` en `unstable_cache` y
 * devuelve una versión 100% serializable (sin `Map`/`Date` crudos) para
 * que pueda atravesar el límite RSC → Client sin sorpresas.
 *
 * Invalidación: `revalidateTag('cpm:<projectId>')` desde
 * `invalidateCpmCache(projectId)` en `./invalidate.ts`. Toda mutación de
 * `Task` o `TaskDependency` debe llamarlo (ver server actions de tareas /
 * dependencias).
 *
 * Nota sobre Next 16: `unstable_cache` está marcado como deprecado en
 * favor de la directiva `use cache` + Cache Components, pero la migración
 * implica habilitar `cacheComponents` a nivel proyecto y opt-in página
 * por página. Mantenemos `unstable_cache` mientras Cache Components no
 * sea política global del repo (deuda registrada en project_followupgantt_tech).
 */

import { unstable_cache } from 'next/cache'
import { computeCpm, type CpmWarning } from './cpm'
import { loadCpmInputForProject } from './prismaAdapter'

export interface CachedCpmTaskResult {
  id: string
  ES: number
  EF: number
  LS: number
  LF: number
  totalFloat: number
  isCritical: boolean
  /** ISO string en UTC (la fecha calculada por CPM, no la de BD). */
  startDate: string
  endDate: string
}

export interface CachedCpmOutput {
  results: CachedCpmTaskResult[]
  criticalPath: string[]
  projectDuration: number
  warnings: CpmWarning[]
}

/**
 * Calcula CPM para un proyecto, retornando un payload serializable. La
 * función interna se envuelve con `unstable_cache` y se etiqueta con
 * `cpm:<projectId>` para invalidación granular.
 *
 * El `keyParts` incluye el id explícitamente (además de pasarlo como
 * argumento) por seguridad — Next ya hashea los args, pero documentar
 * la dependencia explícita evita sorpresas si la firma cambia.
 */
export async function getCachedCpmForProject(
  projectId: string,
): Promise<CachedCpmOutput | null> {
  if (!projectId) return null

  const cached = unstable_cache(
    async (id: string): Promise<CachedCpmOutput | null> => {
      try {
        const input = await loadCpmInputForProject(id)
        if (input.tasks.length === 0) return null
        const out = computeCpm(input)
        const results: CachedCpmTaskResult[] = []
        for (const r of out.results.values()) {
          results.push({
            id: r.id,
            ES: r.ES,
            EF: r.EF,
            LS: r.LS,
            LF: r.LF,
            totalFloat: r.totalFloat,
            isCritical: r.isCritical,
            startDate: r.startDate.toISOString(),
            endDate: r.endDate.toISOString(),
          })
        }
        return {
          results,
          criticalPath: out.criticalPath,
          projectDuration: out.projectDuration,
          warnings: out.warnings,
        }
      } catch {
        // No bloquear el render del Gantt si falla el CPM de un proyecto
        // (ej. lagDays aún no migrado). El caller decide cómo degradar.
        return null
      }
    },
    ['cpm-by-project', projectId],
    { tags: [`cpm:${projectId}`] },
  )

  return cached(projectId)
}
