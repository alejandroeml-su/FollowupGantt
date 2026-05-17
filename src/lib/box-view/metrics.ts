/**
 * US-5.1 · Box View — métricas individuales por miembro del equipo.
 *
 * Lógica pura (sin Prisma ni I/O) para que sea trivialmente testeable y
 * reutilizable desde el page (Server Component) y desde tests unitarios.
 *
 * Diferenciación contra `/workload`: aquí no construimos un heatmap
 * semanal user×week, sino una *tarjeta por persona* con un puñado de
 * KPIs concretos del sprint vigente.
 */

export type BoxTaskInput = {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  progress: number
  startDate: string | null
  endDate: string | null
  sprintId: string | null
  projectName: string | null
  /// Horas estimadas (scrumAttributes.hoursEstimated o equivalente PMI).
  /// Se considera la carga de esta tarea sobre la capacidad semanal.
  estimatedHours: number | null
}

export type BoxMetricsInput = {
  /** Todas las tareas activas (archivedAt null) asignadas al usuario. */
  tasks: BoxTaskInput[]
  /** Id del sprint activo del usuario, o null si no aplica. */
  activeSprintId: string | null
  /** Fecha de referencia para detectar atrasos. Default: Date.now(). */
  now?: Date
  /**
   * Capacidad semanal del usuario en horas (default 40h).
   *  - Heatmap `/workload` usa 8h/día * 5 días → 40h/sem.
   */
  weeklyCapacityHours?: number
}

export type BoxMetrics = {
  activeCount: number
  doneThisSprintCount: number
  overdueCount: number
  /** Progreso promedio (0-100) de tareas no DONE; null si no hay activas. */
  averageProgress: number | null
  /**
   * Horas estimadas (suma) de tareas en curso (no DONE), comparadas
   * con la capacidad semanal. `utilization` = assigned / capacity.
   * `utilization` puede superar 1 (sobreasignación).
   */
  assignedHours: number
  capacityHours: number
  utilization: number
}

const DEFAULT_WEEKLY_CAPACITY = 40

/**
 * Calcula las métricas que pinta `<UserBox/>`. Está aislado del
 * componente para facilitar test puro (`tests/unit/box-view-metrics`).
 */
export function computeBoxMetrics(input: BoxMetricsInput): BoxMetrics {
  const { tasks, activeSprintId } = input
  const now = input.now ?? new Date()
  const capacityHours = input.weeklyCapacityHours ?? DEFAULT_WEEKLY_CAPACITY

  let activeCount = 0
  let overdueCount = 0
  let doneThisSprintCount = 0
  let progressSum = 0
  let progressDen = 0
  let assignedHours = 0

  for (const t of tasks) {
    const isDone = t.status === 'DONE'

    if (!isDone) {
      activeCount += 1
      progressSum += clampProgress(t.progress)
      progressDen += 1

      if (t.estimatedHours && t.estimatedHours > 0) {
        assignedHours += t.estimatedHours
      }

      if (isOverdue(t.endDate, now)) {
        overdueCount += 1
      }
    } else if (activeSprintId && t.sprintId === activeSprintId) {
      // 2026-05-16 · US-5.1 — sólo contamos como "DONE este sprint" si la
      // tarea está enlazada al sprint vigente del usuario. Sin sprint
      // activo este contador se queda en 0 (es honesto: el equipo no
      // está en iteración).
      doneThisSprintCount += 1
    }
  }

  const averageProgress = progressDen > 0 ? progressSum / progressDen : null
  const utilization = capacityHours > 0 ? assignedHours / capacityHours : 0

  return {
    activeCount,
    doneThisSprintCount,
    overdueCount,
    averageProgress,
    assignedHours,
    capacityHours,
    utilization,
  }
}

function clampProgress(p: number): number {
  if (!Number.isFinite(p)) return 0
  if (p < 0) return 0
  if (p > 100) return 100
  return p
}

function isOverdue(endDate: string | null, now: Date): boolean {
  if (!endDate) return false
  const parsed = Date.parse(endDate)
  if (Number.isNaN(parsed)) return false
  return parsed < now.getTime()
}

/**
 * Ordena tareas para el "top 5" visible en la card:
 *   1. Atrasadas primero (endDate < now y no DONE).
 *   2. Luego por prioridad CRITICAL → HIGH → MEDIUM → LOW.
 *   3. Luego por endDate ascendente (lo que vence antes).
 */
export function pickTopTasks<T extends BoxTaskInput>(
  tasks: T[],
  now: Date = new Date(),
  limit = 5,
): T[] {
  const priorityRank: Record<BoxTaskInput['priority'], number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  }

  const active = tasks.filter((t) => t.status !== 'DONE')
  const sorted = active.slice().sort((a, b) => {
    const aOver = isOverdue(a.endDate, now) ? 0 : 1
    const bOver = isOverdue(b.endDate, now) ? 0 : 1
    if (aOver !== bOver) return aOver - bOver
    const pr = priorityRank[a.priority] - priorityRank[b.priority]
    if (pr !== 0) return pr
    const aEnd = a.endDate ? Date.parse(a.endDate) : Number.POSITIVE_INFINITY
    const bEnd = b.endDate ? Date.parse(b.endDate) : Number.POSITIVE_INFINITY
    return aEnd - bEnd
  })

  return sorted.slice(0, limit)
}
