/**
 * Ola P2 · Equipo P2-4 — Helpers puros de OKR.
 *
 * Funciones sin side-effects y sin Prisma. Toman shapes serializables y
 * devuelven números/enum. Esto las hace fáciles de testear y reutilizables
 * desde server actions y desde el cliente (preview optimista).
 *
 * Reglas de cálculo:
 *
 *   PERCENT          → progress = clamp(currentValue, 0, 100)
 *   NUMERIC          → progress = clamp(currentValue / targetValue * 100)
 *   BOOLEAN          → progress = currentValue >= 1 ? 100 : 0
 *   TASKS_COMPLETED  → progress = completedTasks / totalLinked * 100
 *                      (devuelve 0 si no hay tasks vinculadas — evita NaN)
 *
 * `computeGoalProgress` promedia los KRs (peso uniforme). Si el Goal no
 * tiene KRs el progreso es 0; si tiene KRs con metric inválida en runtime
 * se ignoran (defensa, no debería pasar pasada la validación zod del
 * server action).
 *
 * `classifyGoalStatus` deriva ON_TRACK / AT_RISK / OFF_TRACK comparando el
 * progress acumulado con el porcentaje de tiempo transcurrido (heurística
 * inspirada en Lattice/Workboard):
 *   - ON_TRACK   → progress ≥ expectedProgress - 10
 *   - AT_RISK    → progress ≥ expectedProgress - 25
 *   - OFF_TRACK  → resto
 * COMPLETED y CANCELLED NO se devuelven aquí (los setea la UI manualmente).
 */

export type OkrMetric = 'PERCENT' | 'NUMERIC' | 'BOOLEAN' | 'TASKS_COMPLETED'

export type OkrGoalStatus =
  | 'ON_TRACK'
  | 'AT_RISK'
  | 'OFF_TRACK'
  | 'COMPLETED'
  | 'CANCELLED'

export interface KeyResultLike {
  id: string
  metric: OkrMetric
  targetValue: number
  currentValue: number
}

export interface TaskLike {
  id: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
}

export interface GoalLike {
  keyResults: KeyResultLike[]
}

// Constante exportada — usada por el server action (`recomputeKeyResultProgress`)
// y los tests para cuadrar bordes (NaN, división por cero).
export const PROGRESS_MIN = 0
export const PROGRESS_MAX = 100

function clamp(n: number, min = PROGRESS_MIN, max = PROGRESS_MAX): number {
  if (!Number.isFinite(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * Calcula el % de progreso de un KR dado su estado actual y, opcionalmente,
 * la lista de tasks vinculadas (sólo necesaria para metric TASKS_COMPLETED).
 *
 * Devuelve siempre un número entre 0 y 100 (clamp); nunca NaN ni Infinity.
 */
export function computeKeyResultProgress(
  kr: KeyResultLike,
  linkedTasks: TaskLike[] = [],
): number {
  switch (kr.metric) {
    case 'PERCENT': {
      // currentValue ya está expresado como porcentaje (la UI debe forzar
      // 0-100, pero defendemos con clamp por si llega un legacy negativo).
      return clamp(kr.currentValue)
    }
    case 'NUMERIC': {
      // División por cero: si target=0 no hay forma de medir progreso →
      // devolvemos 0. Casos legítimos (ej. "reducir defectos a 0") deben
      // usar PERCENT invertido o tener target>0 con currentValue
      // descendente (no soportado en MVP).
      if (!Number.isFinite(kr.targetValue) || kr.targetValue === 0) {
        return PROGRESS_MIN
      }
      const ratio = (kr.currentValue / kr.targetValue) * 100
      return clamp(ratio)
    }
    case 'BOOLEAN': {
      // currentValue ≥ 1 → completado. Permitimos cualquier número truthy
      // para tolerancia con datos viejos (1, 100, true serializado como 1…)
      return kr.currentValue >= 1 ? PROGRESS_MAX : PROGRESS_MIN
    }
    case 'TASKS_COMPLETED': {
      if (linkedTasks.length === 0) return PROGRESS_MIN
      const done = linkedTasks.filter((t) => t.status === 'DONE').length
      const ratio = (done / linkedTasks.length) * 100
      return clamp(ratio)
    }
    default: {
      // Métrica desconocida en runtime: defensa para evitar NaN aguas abajo.
      // El validador zod del server action ya bloquea este caso al crear.
      return PROGRESS_MIN
    }
  }
}

/**
 * Promedio de los KRs del Goal. Peso uniforme — la decisión D-OKR-1 fue
 * NO exponer pesos por KR en MVP (la mayoría de implementaciones OKR
 * recomiendan KRs equivalentes). Se puede añadir como campo opcional en
 * P2.5.
 *
 * Para `TASKS_COMPLETED` el caller DEBE haber invocado
 * `recomputeKeyResultProgress` antes de persistir el `currentValue`; este
 * helper solo lee `currentValue`.
 */
export function computeGoalProgress(goal: GoalLike): number {
  const krs = goal.keyResults ?? []
  if (krs.length === 0) return PROGRESS_MIN

  let acc = 0
  let count = 0
  for (const kr of krs) {
    // Sin linkedTasks porque este helper opera sobre snapshots ya calculados:
    // el server action persiste `currentValue` con los datos derivados.
    const p = computeKeyResultProgress(kr, [])
    acc += p
    count += 1
  }
  if (count === 0) return PROGRESS_MIN
  return clamp(acc / count)
}

/**
 * Heurística para auto-clasificar el Goal según ritmo:
 *
 *   expectedProgress = (daysElapsed / totalDays) * 100
 *
 *   progress >= expectedProgress - 10 → ON_TRACK
 *   progress >= expectedProgress - 25 → AT_RISK
 *   resto                              → OFF_TRACK
 *
 * Casos borde:
 *   - totalDays <= 0    → ON_TRACK (Goal sin ventana válida; defensa).
 *   - daysElapsed <= 0  → ON_TRACK (Goal aún no inicia).
 *   - daysElapsed >= totalDays:
 *       - progress >= 100 → COMPLETED
 *       - resto           → OFF_TRACK
 */
export function classifyGoalStatus(
  progress: number,
  daysElapsed: number,
  totalDays: number,
): OkrGoalStatus {
  if (!Number.isFinite(totalDays) || totalDays <= 0) return 'ON_TRACK'
  if (daysElapsed <= 0) return 'ON_TRACK'

  // Final del ciclo o pasado: clasificación binaria.
  if (daysElapsed >= totalDays) {
    return progress >= PROGRESS_MAX ? 'COMPLETED' : 'OFF_TRACK'
  }

  const expected = (daysElapsed / totalDays) * 100
  const diff = progress - expected

  if (diff >= -10) return 'ON_TRACK'
  if (diff >= -25) return 'AT_RISK'
  return 'OFF_TRACK'
}

/**
 * Helper para la UI: normaliza un ciclo OKR. Acepta:
 *   - Q1-2026 / Q2-2026 / Q3-2026 / Q4-2026
 *   - H1-2026 / H2-2026
 *   - Y2026
 *
 * Devuelve `true` si matchea, `false` si no. Útil para validar inputs
 * del CycleSelector tanto en cliente como en server action.
 */
export function isValidCycle(cycle: string): boolean {
  if (!cycle || typeof cycle !== 'string') return false
  return /^(Q[1-4]-\d{4}|H[12]-\d{4}|Y\d{4})$/.test(cycle.trim())
}
