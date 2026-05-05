/**
 * Wave P8 · Equipo P8-2 — Simulación Monte Carlo de duración del proyecto.
 *
 * Reusa el CPM existente (`@/lib/scheduling/cpm`) para correr N escenarios
 * independientes. En cada escenario:
 *   1. Para cada riesgo, se "tira el dado": `prob = probability/100` (donde
 *      probability ∈ [1,5] se mapea linealmente a percentiles 0.20..1.00).
 *      Mapeo: lvl 1 → 0.10, lvl 2 → 0.30, lvl 3 → 0.50, lvl 4 → 0.70,
 *      lvl 5 → 0.90 (cuantiles del intervalo).
 *   2. Si materializa, sumamos `triggerDelayDays` a la duración total
 *      (D-RISK-2: en MVP el delay aplica al proyecto completo, no a tasks
 *      específicas).
 *   3. Capturamos la duración resultante.
 *
 * Output: muestras + percentiles P50/P80/P95 + media + stdDev.
 *
 * Determinista: aceptamos un `seed` opcional. Internamente usamos un PRNG
 * Mulberry32 (32-bit, suficiente para Monte Carlo de bajo volumen, no
 * cripto). Reproducible para tests.
 *
 * Sin dependencias externas: el caller pasa el resultado base de `computeCpm`
 * (o cualquier `baselineDuration` numérico) y el array de risks. El módulo
 * NO importa Prisma — es puro.
 */

import type { CpmInput } from '@/lib/scheduling/cpm'
import { computeCpm } from '@/lib/scheduling/cpm'

export interface MonteCarloRiskInput {
  id: string
  /** Probability level ∈ [1,5] (matriz PMBOK 5×5). */
  probability: number
  /** Días añadidos a la duración si el riesgo materializa. */
  triggerDelayDays: number
}

export interface MonteCarloOptions {
  /** Número de simulaciones a correr. Default: 1000. */
  iterations?: number
  /** Seed para PRNG determinista. Default: timestamp. */
  seed?: number
}

export interface MonteCarloResult {
  /** Array de duraciones simuladas (días). Length = iterations. */
  samples: number[]
  /** Mediana (50%). */
  P50: number
  /** Percentil 80 (recomendado PMI para baseline). */
  P80: number
  /** Percentil 95 (worst-case razonable). */
  P95: number
  /** Promedio aritmético. */
  mean: number
  /** Desviación estándar. */
  stdDev: number
  /** Duración base sin riesgos (CPM determinista). */
  baseline: number
  /** Iteraciones efectivamente corridas. */
  iterations: number
}

// ─────────────────────── PRNG Mulberry32 ───────────────────────────
//
// PRNG de 32 bits muy simple (1 línea) con periodo > 4·10^9 — suficiente
// para Monte Carlo de hasta ~10^5 iteraciones. NO usar para criptografía.
// Referencia: https://stackoverflow.com/a/47593316
function makePrng(seed: number): () => number {
  let s = (seed | 0) || 1 // evitar 0 (seed degenerado)
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * Mapeo determinista de `probability ∈ [1,5]` a percentil [0,1].
 *
 * Usamos cuantiles centrados de bins de 0.20: lvl 1 → 0.10 (centro de
 * [0.0, 0.2]), lvl 2 → 0.30, ..., lvl 5 → 0.90. Este mapeo da un MVP
 * intuitivo donde "muy alta" todavía deja espacio a "no materializar"
 * en el ~10% de las corridas.
 *
 * Iteración futura (D-RISK-3.5): permitir override por riesgo con un
 * campo `probabilityPercent` explícito.
 */
export function probabilityLevelToPercent(level: number): number {
  if (!Number.isFinite(level)) return 0
  const bounded = Math.min(5, Math.max(1, Math.round(level)))
  return (bounded - 1) * 0.2 + 0.1
}

// ─────────────────────── Estadísticos ──────────────────────────────

/** Percentil P (0..100) sobre un array no ordenado. Mutación-libre. */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0
  if (p <= 0) return Math.min(...samples)
  if (p >= 100) return Math.max(...samples)
  const sorted = [...samples].sort((a, b) => a - b)
  // Método "nearest-rank" simple (suficiente para Monte Carlo discreto).
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  )
  return sorted[idx]
}

function mean(samples: number[]): number {
  if (samples.length === 0) return 0
  let s = 0
  for (const v of samples) s += v
  return s / samples.length
}

function stdDev(samples: number[], mu: number): number {
  if (samples.length === 0) return 0
  let acc = 0
  for (const v of samples) {
    const d = v - mu
    acc += d * d
  }
  return Math.sqrt(acc / samples.length)
}

// ─────────────────────── Core API ──────────────────────────────────

export interface SimulateProjectDurationInput {
  cpmInput: CpmInput
  risks: MonteCarloRiskInput[]
  options?: MonteCarloOptions
}

/**
 * Corre la simulación Monte Carlo de la duración del proyecto.
 *
 * Para cada iteración:
 *   - Calculamos la duración base 1 vez (cacheada — `cpmInput` no cambia).
 *   - Sumamos delays de risks que materializaron en esa iteración.
 *   - Guardamos la duración total.
 *
 * D-RISK-2: en MVP el delay aplica al proyecto completo. No re-corremos
 * CPM con la lista de tasks modificada porque eso multiplicaría el coste
 * por iteración × tasks. La aproximación es válida cuando los risks
 * impactan la cadena crítica (caso típico).
 */
export function simulateProjectDuration(
  input: SimulateProjectDurationInput,
): MonteCarloResult {
  const iterations = Math.max(1, input.options?.iterations ?? 1000)
  const seed = input.options?.seed ?? Date.now()
  const rng = makePrng(seed)

  // Baseline determinista (1 sola corrida del CPM).
  const cpm = computeCpm(input.cpmInput)
  const baseline = cpm.projectDuration

  // Filtrar risks con datos válidos: probability ∈ [1,5] e impact > 0.
  const activeRisks = input.risks.filter(
    (r) =>
      Number.isFinite(r.probability) &&
      r.probability >= 1 &&
      r.probability <= 5 &&
      Number.isFinite(r.triggerDelayDays) &&
      r.triggerDelayDays > 0,
  )

  const samples: number[] = new Array(iterations)
  for (let i = 0; i < iterations; i++) {
    let duration = baseline
    for (const risk of activeRisks) {
      const threshold = probabilityLevelToPercent(risk.probability)
      if (rng() < threshold) {
        duration += risk.triggerDelayDays
      }
    }
    samples[i] = duration
  }

  const mu = mean(samples)
  return {
    samples,
    P50: percentile(samples, 50),
    P80: percentile(samples, 80),
    P95: percentile(samples, 95),
    mean: mu,
    stdDev: stdDev(samples, mu),
    baseline,
    iterations,
  }
}

/**
 * Construye un histograma simple a partir de las muestras: agrupa por bins
 * de ancho `binWidth` (días) y cuenta frecuencias.
 *
 * Útil para `MonteCarloChart` (UI). Devuelve un array ordenado por límite
 * inferior del bin.
 */
export function histogram(
  samples: number[],
  binWidth = 1,
): Array<{ binStart: number; binEnd: number; count: number }> {
  if (samples.length === 0 || binWidth <= 0) return []
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const start = Math.floor(min / binWidth) * binWidth
  const end = Math.ceil(max / binWidth) * binWidth
  const bins: Array<{ binStart: number; binEnd: number; count: number }> = []
  for (let b = start; b <= end; b += binWidth) {
    bins.push({ binStart: b, binEnd: b + binWidth, count: 0 })
  }
  for (const v of samples) {
    const idx = Math.min(bins.length - 1, Math.floor((v - start) / binWidth))
    bins[idx].count += 1
  }
  return bins
}
