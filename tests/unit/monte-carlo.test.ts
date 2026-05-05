import { describe, it, expect } from 'vitest'
import {
  histogram,
  percentile,
  probabilityLevelToPercent,
  simulateProjectDuration,
  type MonteCarloRiskInput,
} from '@/lib/risks/monte-carlo'
import type { CpmInput } from '@/lib/scheduling/cpm'

/**
 * Wave P8 · Equipo P8-2 — Tests de la simulación Monte Carlo.
 *
 * Cubre:
 *   - PRNG determinista con seed (reproducibilidad).
 *   - Mapeo probability level → percentil.
 *   - Percentiles P50/P80/P95 sobre arrays controlados.
 *   - Simulación con risks que siempre o nunca materializan.
 *   - Histograma básico.
 */

const PROJECT_START = new Date('2026-01-01T00:00:00Z')

function makeCpmInput(durationDays: number): CpmInput {
  // Una sola tarea con duración `durationDays`. CPM da projectDuration =
  // durationDays.
  return {
    projectStart: PROJECT_START,
    tasks: [
      { id: 't1', duration: durationDays, isMilestone: false },
    ],
    dependencies: [],
  }
}

describe('probabilityLevelToPercent', () => {
  it('mapea cuantiles centrados de bins 0.20', () => {
    expect(probabilityLevelToPercent(1)).toBeCloseTo(0.1, 6)
    expect(probabilityLevelToPercent(2)).toBeCloseTo(0.3, 6)
    expect(probabilityLevelToPercent(3)).toBeCloseTo(0.5, 6)
    expect(probabilityLevelToPercent(4)).toBeCloseTo(0.7, 6)
    expect(probabilityLevelToPercent(5)).toBeCloseTo(0.9, 6)
  })

  it('clampa valores fuera de rango', () => {
    expect(probabilityLevelToPercent(0)).toBeCloseTo(0.1, 6)
    expect(probabilityLevelToPercent(7)).toBeCloseTo(0.9, 6)
  })

  it('redondea valores no enteros', () => {
    expect(probabilityLevelToPercent(2.4)).toBeCloseTo(0.3, 6)
    expect(probabilityLevelToPercent(2.6)).toBeCloseTo(0.5, 6)
  })
})

describe('percentile', () => {
  it('mediana de [1..10] = 5', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
  })

  it('P95 de [1..100] está cerca de 95', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(arr, 95)).toBeGreaterThanOrEqual(95)
    expect(percentile(arr, 95)).toBeLessThanOrEqual(96)
  })

  it('P0 = min, P100 = max', () => {
    expect(percentile([5, 1, 9, 3], 0)).toBe(1)
    expect(percentile([5, 1, 9, 3], 100)).toBe(9)
  })

  it('array vacío → 0', () => {
    expect(percentile([], 50)).toBe(0)
  })
})

describe('simulateProjectDuration · sin risks', () => {
  it('todas las muestras = baseline cuando no hay risks', () => {
    const result = simulateProjectDuration({
      cpmInput: makeCpmInput(10),
      risks: [],
      options: { iterations: 50, seed: 42 },
    })
    expect(result.baseline).toBe(10)
    expect(result.iterations).toBe(50)
    expect(result.samples).toHaveLength(50)
    expect(result.samples.every((s) => s === 10)).toBe(true)
    expect(result.P50).toBe(10)
    expect(result.P80).toBe(10)
    expect(result.P95).toBe(10)
    expect(result.stdDev).toBe(0)
  })
})

describe('simulateProjectDuration · risks degenerados', () => {
  it('risk con triggerDelayDays=0 no afecta (filtrado)', () => {
    const risks: MonteCarloRiskInput[] = [
      { id: 'r1', probability: 5, triggerDelayDays: 0 },
    ]
    const result = simulateProjectDuration({
      cpmInput: makeCpmInput(10),
      risks,
      options: { iterations: 100, seed: 1 },
    })
    expect(result.samples.every((s) => s === 10)).toBe(true)
  })

  it('risk con probability=0 (inválido) se filtra', () => {
    const risks: MonteCarloRiskInput[] = [
      { id: 'r1', probability: 0, triggerDelayDays: 5 },
    ]
    const result = simulateProjectDuration({
      cpmInput: makeCpmInput(10),
      risks,
      options: { iterations: 100, seed: 1 },
    })
    expect(result.samples.every((s) => s === 10)).toBe(true)
  })
})

describe('simulateProjectDuration · determinismo', () => {
  it('misma seed → mismas muestras (reproducible)', () => {
    const cpmInput = makeCpmInput(20)
    const risks: MonteCarloRiskInput[] = [
      { id: 'r1', probability: 3, triggerDelayDays: 5 },
      { id: 'r2', probability: 4, triggerDelayDays: 10 },
    ]
    const a = simulateProjectDuration({
      cpmInput,
      risks,
      options: { iterations: 200, seed: 12345 },
    })
    const b = simulateProjectDuration({
      cpmInput,
      risks,
      options: { iterations: 200, seed: 12345 },
    })
    expect(a.samples).toEqual(b.samples)
    expect(a.P50).toBe(b.P50)
    expect(a.P95).toBe(b.P95)
  })

  it('seeds distintas producen series distintas', () => {
    const cpmInput = makeCpmInput(20)
    const risks: MonteCarloRiskInput[] = [
      { id: 'r1', probability: 3, triggerDelayDays: 5 },
    ]
    const a = simulateProjectDuration({
      cpmInput,
      risks,
      options: { iterations: 500, seed: 1 },
    })
    const b = simulateProjectDuration({
      cpmInput,
      risks,
      options: { iterations: 500, seed: 2 },
    })
    // Al menos una muestra debe diferir; no podemos garantizar todas.
    const someDiff = a.samples.some((s, i) => s !== b.samples[i])
    expect(someDiff).toBe(true)
  })
})

describe('simulateProjectDuration · estadística esperada', () => {
  it('risk muy alto (lvl 5 ≈ 90%) materializa la mayoría de las veces', () => {
    const cpmInput = makeCpmInput(100)
    const risks: MonteCarloRiskInput[] = [
      { id: 'r1', probability: 5, triggerDelayDays: 50 },
    ]
    const result = simulateProjectDuration({
      cpmInput,
      risks,
      options: { iterations: 2000, seed: 7 },
    })
    const ratio = result.samples.filter((s) => s === 150).length / 2000
    // Mulberry32 con threshold 0.9 debería dar ~90% materializados.
    expect(ratio).toBeGreaterThan(0.85)
    expect(ratio).toBeLessThan(0.95)
    expect(result.mean).toBeGreaterThan(140)
    expect(result.mean).toBeLessThan(150)
  })

  it('risk muy bajo (lvl 1 ≈ 10%) materializa pocas veces', () => {
    const cpmInput = makeCpmInput(100)
    const risks: MonteCarloRiskInput[] = [
      { id: 'r1', probability: 1, triggerDelayDays: 50 },
    ]
    const result = simulateProjectDuration({
      cpmInput,
      risks,
      options: { iterations: 2000, seed: 7 },
    })
    const ratio = result.samples.filter((s) => s === 150).length / 2000
    expect(ratio).toBeGreaterThan(0.05)
    expect(ratio).toBeLessThan(0.15)
  })

  it('P80 ≥ P50 ≥ baseline cuando hay risks positivos', () => {
    const cpmInput = makeCpmInput(50)
    const risks: MonteCarloRiskInput[] = [
      { id: 'r1', probability: 3, triggerDelayDays: 10 },
      { id: 'r2', probability: 4, triggerDelayDays: 20 },
    ]
    const result = simulateProjectDuration({
      cpmInput,
      risks,
      options: { iterations: 1000, seed: 99 },
    })
    expect(result.baseline).toBe(50)
    expect(result.P50).toBeGreaterThanOrEqual(result.baseline)
    expect(result.P80).toBeGreaterThanOrEqual(result.P50)
    expect(result.P95).toBeGreaterThanOrEqual(result.P80)
  })

  it('default iterations = 1000 cuando no se especifica', () => {
    const cpmInput = makeCpmInput(5)
    const result = simulateProjectDuration({
      cpmInput,
      risks: [],
      options: { seed: 1 },
    })
    expect(result.iterations).toBe(1000)
    expect(result.samples).toHaveLength(1000)
  })
})

describe('histogram', () => {
  it('agrupa muestras en bins de ancho 1', () => {
    const bins = histogram([10, 10, 11, 11, 11, 12], 1)
    expect(bins).toEqual([
      { binStart: 10, binEnd: 11, count: 2 },
      { binStart: 11, binEnd: 12, count: 3 },
      { binStart: 12, binEnd: 13, count: 1 },
    ])
  })

  it('muestras vacías → array vacío', () => {
    expect(histogram([])).toEqual([])
  })

  it('binWidth=0 (inválido) → array vacío', () => {
    expect(histogram([1, 2, 3], 0)).toEqual([])
  })

  it('agrupa con binWidth=5', () => {
    const bins = histogram([10, 12, 14, 15, 19, 20], 5)
    expect(bins.length).toBeGreaterThan(0)
    const total = bins.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(6)
  })
})
