/**
 * Ola P5 · Equipo P5-4 · AI Insights — Predicción heurística de riesgo de retraso.
 *
 * Sin LLM: combinamos cuatro factores estadísticos para producir un
 * score 0..1 y un nivel cualitativo (low / medium / high). Determinista:
 *   - misma entrada → misma salida.
 *   - sin Date.now(); el `now` se inyecta desde el server action.
 *
 * Factores:
 *   (a) progressVsElapsed: si la tarea ya consumió X% de su ventana de
 *       tiempo pero el `progress` está por debajo de 0.8·X, sumamos
 *       hasta 0.5 según el delta. Tareas cerradas (status DONE) o sin
 *       fechas no contribuyen aquí.
 *   (b) historicalLateness: si el assignee tiene >30% de tareas pasadas
 *       entregadas tarde, +0.2.
 *   (c) taskSize: estimatedHours > 40h → +0.15 (proxy: tasks largas
 *       suelen retrasarse por subdivisión incompleta).
 *   (d) pendingPredecessors: cada predecesora pendiente (status !=
 *       DONE) suma +0.1, con cap 0.4.
 *
 * Niveles:
 *   - score < 0.34 → 'low'
 *   - score < 0.67 → 'medium'
 *   - score ≥ 0.67 → 'high'
 *
 * Las fronteras son intencionalmente "tercios" para que un usuario que
 * acumule 2 factores moderados ya entre en medium.
 */

export interface RiskTaskInput {
  id: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
  progress: number
  startDate: Date | null
  endDate: Date | null
  /** Estimación en horas. Nullable cuando el equipo no la captura. */
  estimatedHours?: number | null
  assigneeId: string | null
  /** Predecesoras (status simplificado para el cálculo). */
  predecessors?: Array<{ id: string; status: RiskTaskInput['status'] }>
}

export interface RiskAssigneeHistory {
  /** Total tasks pasadas (status=DONE). */
  totalCompleted: number
  /** De ellas, cuántas terminaron tarde (endDate < completedAt). */
  totalLate: number
}

export type RiskLevel = 'low' | 'medium' | 'high'

export interface RiskResult {
  score: number
  level: RiskLevel
  factors: string[]
}

const FACTOR_WEIGHTS = {
  PROGRESS_LAG_MAX: 0.5,
  // Vencida (endDate pasó y task no está DONE): factor más fuerte que el
  // simple "progreso por debajo del esperado", para que aún sin otros
  // factores la tarea entre en `high`.
  OVERDUE: 0.7,
  HISTORICAL_LATENESS: 0.2,
  LARGE_TASK: 0.15,
  PER_PENDING_PREDECESSOR: 0.1,
  PENDING_PREDECESSORS_MAX: 0.4,
} as const

/**
 * Calcula el ratio "qué fracción de la ventana de la tarea ha pasado".
 * Devuelve null si no hay fechas válidas o `now` no cae en el rango.
 */
function elapsedRatio(start: Date, end: Date, now: Date): number | null {
  const total = end.getTime() - start.getTime()
  if (total <= 0) return null
  const elapsed = now.getTime() - start.getTime()
  if (elapsed < 0) return 0 // aún no inicia
  if (elapsed > total) return 1 // ya venció
  return elapsed / total
}

/**
 * Predice el riesgo de retraso a partir de la tarea, el historial del
 * assignee y el `now` inyectado.
 */
export function predictDelayRisk(
  task: RiskTaskInput,
  assigneeHistory: RiskAssigneeHistory | null,
  now: Date,
): RiskResult {
  const factors: string[] = []
  let score = 0

  // (a) progressVsElapsed
  if (
    task.status !== 'DONE' &&
    task.startDate &&
    task.endDate &&
    Number.isFinite(task.progress)
  ) {
    const ratio = elapsedRatio(task.startDate, task.endDate, now)
    // "Vencida": now > endDate y progress < 100. Aplicamos cap del factor
    // (PROGRESS_LAG_MAX) y razón explícita.
    const overdueByEndDate =
      task.endDate.getTime() < now.getTime() && task.progress < 100
    if (overdueByEndDate) {
      score += FACTOR_WEIGHTS.OVERDUE
      factors.push('La tarea está vencida y aún no se marca como DONE')
    } else if (ratio !== null && ratio > 0) {
      const expectedProgress = ratio * 100 * 0.8 // toleramos 20% de lag
      if (task.progress < expectedProgress) {
        // Mapeo lineal: a mayor delta, más score (cap 0.5).
        const deltaPct = expectedProgress - task.progress // 0..100
        const contrib = Math.min(
          FACTOR_WEIGHTS.PROGRESS_LAG_MAX,
          (deltaPct / 100) * FACTOR_WEIGHTS.PROGRESS_LAG_MAX * 2,
        )
        score += contrib
        factors.push(
          `Progreso (${task.progress}%) por debajo del esperado (~${Math.round(
            expectedProgress,
          )}%) según tiempo transcurrido (${Math.round(ratio * 100)}%)`,
        )
      }
    }
  }

  // (b) historicalLateness
  if (assigneeHistory && assigneeHistory.totalCompleted >= 5) {
    const lateRatio =
      assigneeHistory.totalLate / Math.max(1, assigneeHistory.totalCompleted)
    if (lateRatio > 0.3) {
      score += FACTOR_WEIGHTS.HISTORICAL_LATENESS
      factors.push(
        `Asignado entrega tarde el ${Math.round(lateRatio * 100)}% de tareas pasadas`,
      )
    }
  }

  // (c) taskSize
  if (typeof task.estimatedHours === 'number' && task.estimatedHours > 40) {
    score += FACTOR_WEIGHTS.LARGE_TASK
    factors.push(
      `Tarea grande (${task.estimatedHours}h estimadas, > 40h umbral)`,
    )
  }

  // (d) pendingPredecessors
  const pendingPreds = (task.predecessors ?? []).filter((p) => p.status !== 'DONE')
  if (pendingPreds.length > 0) {
    const contrib = Math.min(
      FACTOR_WEIGHTS.PENDING_PREDECESSORS_MAX,
      pendingPreds.length * FACTOR_WEIGHTS.PER_PENDING_PREDECESSOR,
    )
    score += contrib
    factors.push(
      `${pendingPreds.length} predecesora(s) pendientes (+${contrib.toFixed(2)})`,
    )
  }

  // Cap final 0..1.
  score = Math.max(0, Math.min(1, score))

  let level: RiskLevel
  if (score < 0.34) level = 'low'
  else if (score < 0.67) level = 'medium'
  else level = 'high'

  if (factors.length === 0) {
    factors.push('Sin señales de riesgo detectadas')
  }

  return { score: round2(score), level, factors }
}

/** Redondea a 2 decimales (determinista, sin sesgo float). */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
