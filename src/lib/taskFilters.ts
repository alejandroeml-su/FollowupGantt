import type { SerializedTask } from '@/lib/types'

export type TaskFilters = {
  gerenciaId?: string
  areaId?: string
  projectId?: string
  status?: string
  type?: string
  priority?: string
  assigneeId?: string // '__unassigned__' => tareas sin responsable
  /** Wave P9 — filtro por Epic.
   * '__no_epic__' = tareas sin Epic asignada. */
  epicId?: string
  /** Fecha inicial del rango (YYYY-MM-DD, UTC). Filtra tareas con overlap. */
  dateFrom?: string
  /** Fecha final del rango (YYYY-MM-DD, UTC). Filtra tareas con overlap. */
  dateTo?: string
}

export const NO_EPIC_VALUE = '__no_epic__'

export const EMPTY_TASK_FILTERS: TaskFilters = {}
export const UNASSIGNED_VALUE = '__unassigned__'

export function hasActiveFilters(f: TaskFilters): boolean {
  return Object.values(f).some((v) => v !== undefined && v !== '')
}

export function countActiveFilters(f: TaskFilters): number {
  return Object.values(f).filter((v) => v !== undefined && v !== '').length
}

/**
 * Una tarea pasa el filtro de rango si su intervalo [startDate, endDate] se
 * solapa con [dateFrom, dateTo]. Tareas sin fechas se excluyen cuando el
 * filtro está activo (no están "en el periodo"). Si solo hay startDate, se
 * asume endDate=+∞ (sigue activa); si solo hay endDate, startDate=-∞.
 */
export function matchesDateRange(
  task: SerializedTask,
  dateFrom?: string,
  dateTo?: string,
): boolean {
  if (!dateFrom && !dateTo) return true

  const taskStart = task.startDate ? Date.parse(task.startDate) : null
  const taskEnd = task.endDate ? Date.parse(task.endDate) : null

  if (taskStart === null && taskEnd === null) return false

  const effStart = taskStart ?? Number.NEGATIVE_INFINITY
  const effEnd = taskEnd ?? Number.POSITIVE_INFINITY

  const f0 = dateFrom ? Date.parse(`${dateFrom}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY
  const f1 = dateTo ? Date.parse(`${dateTo}T23:59:59.999Z`) : Number.POSITIVE_INFINITY

  return effStart <= f1 && effEnd >= f0
}

export function matchesFilters(task: SerializedTask, f: TaskFilters): boolean {
  if (f.gerenciaId && task.gerenciaId !== f.gerenciaId) return false
  if (f.areaId && task.areaId !== f.areaId) return false
  if (f.projectId && task.projectId !== f.projectId) return false
  if (f.status && task.status !== f.status) return false
  if (f.type && task.type !== f.type) return false
  if (f.priority && task.priority !== f.priority) return false
  if (f.assigneeId) {
    if (f.assigneeId === UNASSIGNED_VALUE) {
      if (task.assigneeId) return false
    } else if (task.assigneeId !== f.assigneeId) {
      return false
    }
  }
  if (f.epicId) {
    if (f.epicId === NO_EPIC_VALUE) {
      if (task.epicId) return false
    } else if (task.epicId !== f.epicId) {
      return false
    }
  }
  if (!matchesDateRange(task, f.dateFrom, f.dateTo)) return false
  return true
}

export function filterTasks<T extends SerializedTask>(tasks: T[], f: TaskFilters): T[] {
  if (!hasActiveFilters(f)) return tasks
  return tasks.filter((t) => matchesFilters(t, f))
}

/**
 * Incluye el padre si pasa el filtro o si algún descendiente pasa.
 * La lista de subtareas devuelta sólo conserva las ramas que aportan
 * nodos coincidentes (recursivo a N niveles).
 *
 * Antes era 1-nivel: si un nieto coincidía con el filtro pero el
 * padre intermedio no, la rama entera quedaba escondida. Ahora la
 * rama se preserva mientras al menos un descendiente coincida.
 */
export function filterTasksWithSubtasks<
  T extends SerializedTask & { subtasks?: SerializedTask[] },
>(tasks: T[], f: TaskFilters): T[] {
  if (!hasActiveFilters(f)) return tasks
  const visit = (list: T[]): T[] => {
    const out: T[] = []
    for (const t of list) {
      const filteredSubs = visit((t.subtasks ?? []) as T[])
      const selfMatches = matchesFilters(t, f)
      if (selfMatches || filteredSubs.length > 0) {
        out.push({ ...t, subtasks: filteredSubs } as T)
      }
    }
    return out
  }
  return visit(tasks)
}
