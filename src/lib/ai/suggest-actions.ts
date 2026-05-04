/**
 * Ola P5 · Equipo P5-4 · AI Insights — Sugerencias de "next actions".
 *
 * Genera 3-5 sugerencias accionables a nivel proyecto a partir de
 * señales detectables sin LLM:
 *   - Tareas en CP (camino crítico) sin assignee.
 *   - Tareas vencidas sin actualizar (updatedAt > N días).
 *   - Tareas con baseline drift > 5 días respecto a la línea base
 *     más reciente.
 *   - Tareas DONE con progress < 100 (incoherencia).
 *   - Sprints activos sin capacity definida.
 *
 * Determinista: misma entrada → misma salida; sólo el `now` se inyecta.
 */

export interface SuggestTaskInput {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
  progress: number
  assigneeId: string | null
  endDate: Date | null
  updatedAt: Date
  /** Marca si la tarea está en el camino crítico (provisto por CPM upstream). */
  inCriticalPath?: boolean
  /** Drift en días entre baseline.endDate y task.endDate (positivo = atrasado). */
  baselineDriftDays?: number | null
}

export interface SuggestSprintInput {
  id: string
  name: string
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED'
  capacity: number | null
}

export interface SuggestProjectInput {
  id: string
  name: string
  tasks: SuggestTaskInput[]
  sprints?: SuggestSprintInput[]
}

export interface NextAction {
  /** Slug estable para UI (ej. "cp-without-assignee"). */
  key: string
  /** Texto user-facing en ES. */
  message: string
  /** Cantidad de items que motivaron la sugerencia. */
  count: number
  /** Severidad 0..1 (mayor = más urgente). */
  severity: number
}

const STALE_DAYS_THRESHOLD = 7
const BASELINE_DRIFT_THRESHOLD_DAYS = 5

/**
 * Genera la lista de sugerencias para un proyecto.
 * Devuelve hasta 5, ordenadas por severity desc.
 */
export function suggestNextActions(
  project: SuggestProjectInput,
  now: Date,
): NextAction[] {
  const actions: NextAction[] = []

  const openTasks = project.tasks.filter((t) => t.status !== 'DONE')

  // 1. CP sin assignee
  const cpUnassigned = openTasks.filter(
    (t) => t.inCriticalPath === true && !t.assigneeId,
  )
  if (cpUnassigned.length > 0) {
    actions.push({
      key: 'cp-without-assignee',
      message: `${cpUnassigned.length} tarea(s) en camino crítico sin responsable asignado`,
      count: cpUnassigned.length,
      severity: Math.min(1, 0.6 + cpUnassigned.length * 0.1),
    })
  }

  // 2. Vencidas y sin actualizar hace > N días
  const stale = openTasks.filter((t) => {
    if (!t.endDate) return false
    if (t.endDate.getTime() >= now.getTime()) return false
    const daysSinceUpdate =
      (now.getTime() - t.updatedAt.getTime()) / (1000 * 60 * 60 * 24)
    return daysSinceUpdate > STALE_DAYS_THRESHOLD
  })
  if (stale.length > 0) {
    actions.push({
      key: 'overdue-stale',
      message: `${stale.length} tarea(s) vencida(s) sin actualizar en los últimos ${STALE_DAYS_THRESHOLD} días`,
      count: stale.length,
      severity: Math.min(1, 0.5 + stale.length * 0.05),
    })
  }

  // 3. Baseline drift > umbral
  const drifted = openTasks.filter(
    (t) =>
      typeof t.baselineDriftDays === 'number' &&
      t.baselineDriftDays > BASELINE_DRIFT_THRESHOLD_DAYS,
  )
  if (drifted.length > 0) {
    actions.push({
      key: 'baseline-drift',
      message: `${drifted.length} tarea(s) con desviación de baseline > ${BASELINE_DRIFT_THRESHOLD_DAYS} días`,
      count: drifted.length,
      severity: Math.min(1, 0.4 + drifted.length * 0.05),
    })
  }

  // 4. Inconsistencia DONE con progress < 100
  const inconsistentDone = project.tasks.filter(
    (t) => t.status === 'DONE' && t.progress < 100,
  )
  if (inconsistentDone.length > 0) {
    actions.push({
      key: 'done-incoherent-progress',
      message: `${inconsistentDone.length} tarea(s) marcadas DONE con progreso < 100%`,
      count: inconsistentDone.length,
      severity: 0.3,
    })
  }

  // 5. Sprints activos sin capacity
  const sprintsNoCapacity = (project.sprints ?? []).filter(
    (s) => s.status === 'ACTIVE' && (s.capacity == null || s.capacity <= 0),
  )
  if (sprintsNoCapacity.length > 0) {
    actions.push({
      key: 'sprint-no-capacity',
      message: `${sprintsNoCapacity.length} sprint(s) activos sin capacity definido`,
      count: sprintsNoCapacity.length,
      severity: 0.4,
    })
  }

  // Orden estable: severity desc, luego key asc.
  actions.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity
    return a.key.localeCompare(b.key)
  })

  return actions.slice(0, 5)
}
