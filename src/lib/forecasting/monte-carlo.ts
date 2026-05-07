/**
 * Wave P10 (HU-10.3 · GAMMA-1.2) — Monte Carlo "lite" para forecasting de
 * velocity de equipo.
 *
 * Recibe el histórico de velocity (SP completados por sprint) y simula N
 * iteraciones del próximo sprint muestreando con reemplazo. Devuelve los
 * percentiles P10 / P50 / P90 — banda de confianza para commitments.
 *
 * Decisión:
 *  - Sin librerías externas (PRNG nativo Math.random suficiente para 1k iter)
 *  - 1000 iteraciones por defecto: balance entre estabilidad y costo
 *  - Si historial < 3 sprints, devolvemos null (no hay base estadística)
 *
 * Módulo puro, testeable sin Prisma.
 */

export interface VelocityHistoryEntry {
  sprintId: string
  sprintName: string
  /** Story points completados en ese sprint. */
  completedSp: number
  /** ISO de cierre del sprint (para ordenar/contextualizar). */
  endDate: string
}

export interface VelocityForecast {
  /** Percentil 10 (pesimista — solo 10% de simulaciones bajo este valor). */
  p10: number
  /** Mediana (50% de simulaciones bajo este valor). */
  p50: number
  /** Percentil 90 (optimista). */
  p90: number
  /** Promedio aritmético de todas las simulaciones. */
  mean: number
  /** Desviación estándar muestral. */
  stddev: number
  /** Sprints históricos usados (los últimos N). */
  sampleSize: number
  /** Iteraciones Monte Carlo ejecutadas. */
  iterations: number
}

const MIN_HISTORY_SPRINTS = 3
const DEFAULT_ITERATIONS = 1000

/**
 * Simula N iteraciones del siguiente sprint. Cada iteración toma una muestra
 * con reemplazo del histórico — bootstrap percentile method.
 *
 * Si `history.length < 3` devuelve null.
 */
export function forecastNextSprintVelocity(
  history: ReadonlyArray<VelocityHistoryEntry>,
  iterations = DEFAULT_ITERATIONS,
): VelocityForecast | null {
  if (history.length < MIN_HISTORY_SPRINTS) return null
  if (iterations < 100) iterations = 100

  const sps = history.map((h) => h.completedSp)
  const samples: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    const idx = Math.floor(Math.random() * sps.length)
    samples[i] = sps[idx]
  }

  samples.sort((a, b) => a - b)

  const p = (q: number) => {
    const idx = Math.floor(q * (samples.length - 1))
    return samples[idx]
  }

  const mean = samples.reduce((acc, n) => acc + n, 0) / samples.length
  const variance =
    samples.reduce((acc, n) => acc + (n - mean) ** 2, 0) / samples.length
  const stddev = Math.sqrt(variance)

  return {
    p10: p(0.1),
    p50: p(0.5),
    p90: p(0.9),
    mean: Number(mean.toFixed(2)),
    stddev: Number(stddev.toFixed(2)),
    sampleSize: history.length,
    iterations,
  }
}

/**
 * Forecast multi-sprint: dado N sprints futuros y un histórico, simula
 * cuántos SP totales se completarán acumulados en los N sprints siguientes.
 * Útil para responder "¿llegamos a release con K SP en X sprints?".
 */
export interface MultiSprintForecast extends VelocityForecast {
  /** Nº de sprints futuros simulados. */
  horizonSprints: number
}

export function forecastCumulativeVelocity(
  history: ReadonlyArray<VelocityHistoryEntry>,
  horizonSprints: number,
  iterations = DEFAULT_ITERATIONS,
): MultiSprintForecast | null {
  if (history.length < MIN_HISTORY_SPRINTS) return null
  if (horizonSprints < 1) return null
  if (iterations < 100) iterations = 100

  const sps = history.map((h) => h.completedSp)
  const totals: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    let total = 0
    for (let s = 0; s < horizonSprints; s++) {
      const idx = Math.floor(Math.random() * sps.length)
      total += sps[idx]
    }
    totals[i] = total
  }

  totals.sort((a, b) => a - b)

  const p = (q: number) => {
    const idx = Math.floor(q * (totals.length - 1))
    return totals[idx]
  }

  const mean = totals.reduce((acc, n) => acc + n, 0) / totals.length
  const variance =
    totals.reduce((acc, n) => acc + (n - mean) ** 2, 0) / totals.length
  const stddev = Math.sqrt(variance)

  return {
    p10: p(0.1),
    p50: p(0.5),
    p90: p(0.9),
    mean: Number(mean.toFixed(2)),
    stddev: Number(stddev.toFixed(2)),
    sampleSize: history.length,
    iterations,
    horizonSprints,
  }
}

/**
 * Estima la probabilidad (0..1) de completar `targetSp` story points dentro
 * de `horizonSprints` sprints, dada la velocity histórica.
 *
 * Útil para preguntas tipo "¿qué tan probable es liberar Release X (35 SP)
 * en los próximos 3 sprints?".
 */
export function probabilityOfCompletion(
  history: ReadonlyArray<VelocityHistoryEntry>,
  targetSp: number,
  horizonSprints: number,
  iterations = DEFAULT_ITERATIONS,
): number | null {
  if (history.length < MIN_HISTORY_SPRINTS) return null
  if (horizonSprints < 1) return null
  if (targetSp <= 0) return 1

  const sps = history.map((h) => h.completedSp)
  let success = 0
  for (let i = 0; i < iterations; i++) {
    let total = 0
    for (let s = 0; s < horizonSprints; s++) {
      const idx = Math.floor(Math.random() * sps.length)
      total += sps[idx]
    }
    if (total >= targetSp) success++
  }
  return Number((success / iterations).toFixed(3))
}
