import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  forecastCumulativeVelocity,
  forecastNextSprintVelocity,
  probabilityOfCompletion,
  type VelocityHistoryEntry,
} from '@/lib/forecasting/monte-carlo'

// Helper para construir history rápido.
function h(values: number[]): VelocityHistoryEntry[] {
  return values.map((sp, i) => ({
    sprintId: `s${i}`,
    sprintName: `Sprint ${i + 1}`,
    completedSp: sp,
    endDate: new Date(2026, 0, i + 1).toISOString(),
  }))
}

describe('velocity-forecasting · forecastNextSprintVelocity', () => {
  it('null si history < 3 sprints', () => {
    expect(forecastNextSprintVelocity(h([10, 20]))).toBeNull()
    expect(forecastNextSprintVelocity(h([10]))).toBeNull()
  })

  it('p10 ≤ p50 ≤ p90 siempre', () => {
    const f = forecastNextSprintVelocity(h([10, 12, 15, 18, 20]))
    expect(f).not.toBeNull()
    expect(f!.p10).toBeLessThanOrEqual(f!.p50)
    expect(f!.p50).toBeLessThanOrEqual(f!.p90)
  })

  it('historial constante → todos los percentiles iguales', () => {
    const f = forecastNextSprintVelocity(h([10, 10, 10, 10, 10]))
    expect(f!.p10).toBe(10)
    expect(f!.p50).toBe(10)
    expect(f!.p90).toBe(10)
    expect(f!.stddev).toBe(0)
  })

  it('mean cercano al promedio histórico (con seed determinístico)', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.5)
    const f = forecastNextSprintVelocity(h([10, 20, 30]))
    // Math.random() siempre 0.5 → idx = floor(0.5 * 3) = 1 → siempre toma 20
    expect(f!.mean).toBe(20)
    vi.restoreAllMocks()
  })

  it('iterations < 100 se eleva a 100 implícitamente', () => {
    const f = forecastNextSprintVelocity(h([10, 12, 15]), 50)
    expect(f!.iterations).toBe(100)
  })
})

describe('velocity-forecasting · forecastCumulativeVelocity', () => {
  it('null si history < 3 sprints', () => {
    expect(forecastCumulativeVelocity(h([10, 20]), 3)).toBeNull()
  })

  it('null si horizonSprints < 1', () => {
    expect(forecastCumulativeVelocity(h([10, 12, 15]), 0)).toBeNull()
  })

  it('horizon=1 produce mismo mean que forecastNextSprint con seed fijo', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0.5)
    const cumul = forecastCumulativeVelocity(h([10, 20, 30]), 1)
    const next = forecastNextSprintVelocity(h([10, 20, 30]))
    expect(cumul!.mean).toBe(next!.mean)
    vi.restoreAllMocks()
  })

  it('horizon=3 con velocity constante=10 → total=30 en todos los percentiles', () => {
    const f = forecastCumulativeVelocity(h([10, 10, 10, 10, 10]), 3)
    expect(f!.p10).toBe(30)
    expect(f!.p50).toBe(30)
    expect(f!.p90).toBe(30)
    expect(f!.horizonSprints).toBe(3)
  })
})

describe('velocity-forecasting · probabilityOfCompletion', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('null si history < 3', () => {
    expect(probabilityOfCompletion(h([10, 20]), 30, 3)).toBeNull()
  })

  it('1.0 si target ≤ 0 (vacuo)', () => {
    expect(probabilityOfCompletion(h([10, 12, 15]), 0, 3)).toBe(1)
    expect(probabilityOfCompletion(h([10, 12, 15]), -5, 3)).toBe(1)
  })

  it('1.0 cuando velocity 10 cubre con margen target=15 en 3 sprints', () => {
    expect(probabilityOfCompletion(h([10, 10, 10]), 15, 3)).toBe(1)
  })

  it('0.0 cuando target inalcanzable', () => {
    expect(probabilityOfCompletion(h([5, 5, 5]), 100, 1)).toBe(0)
  })

  it('valor entre 0 y 1 con histórico variable', () => {
    const p = probabilityOfCompletion(h([5, 10, 15, 20, 25]), 60, 3, 2000)
    expect(p).not.toBeNull()
    expect(p!).toBeGreaterThanOrEqual(0)
    expect(p!).toBeLessThanOrEqual(1)
  })
})
