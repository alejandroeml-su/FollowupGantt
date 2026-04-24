import type { SerializedTask } from '@/lib/types'

export type TaskFilters = {
  gerenciaId?: string
  areaId?: string
  projectId?: string
  status?: string
  type?: string
  priority?: string
  assigneeId?: string // '__unassigned__' => tareas sin responsable
}

export const EMPTY_TASK_FILTERS: TaskFilters = {}
export const UNASSIGNED_VALUE = '__unassigned__'

export function hasActiveFilters(f: TaskFilters): boolean {
  return Object.values(f).some((v) => v !== undefined && v !== '')
}

export function countActiveFilters(f: TaskFilters): number {
  return Object.values(f).filter((v) => v !== undefined && v !== '').length
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
  return true
}

export function filterTasks<T extends SerializedTask>(tasks: T[], f: TaskFilters): T[] {
  if (!hasActiveFilters(f)) return tasks
  return tasks.filter((t) => matchesFilters(t, f))
}

/**
 * Incluye el padre si pasa el filtro o si alguna subtarea pasa.
 * La lista de subtareas devuelta solo contiene las que pasan.
 */
export function filterTasksWithSubtasks<
  T extends SerializedTask & { subtasks?: SerializedTask[] },
>(tasks: T[], f: TaskFilters): T[] {
  if (!hasActiveFilters(f)) return tasks
  const out: T[] = []
  for (const t of tasks) {
    const matchedSubs = (t.subtasks ?? []).filter((s) => matchesFilters(s, f))
    const selfMatches = matchesFilters(t, f)
    if (selfMatches || matchedSubs.length > 0) {
      out.push({ ...t, subtasks: matchedSubs } as T)
    }
  }
  return out
}
