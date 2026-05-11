/**
 * Wave P20-B · Tests unitarios del Monte Carlo cross-project simulator
 * del Brain Strategist (NO confundir con `lib/risks/monte-carlo` Wave P8).
 *
 * Cubre:
 *   - Determinismo con seed fija (xorshift32 reproducible).
 *   - Orden de percentiles (P10 ≤ P50 ≤ P90).
 *   - Sample size respeta `iterations`.
 *   - Caso trivial (std=0) → P50 == mean.
 *   - Caso cross-dep (B depende de A) → P50(B) > P50(A).
 *   - Detección de ciclos.
 *   - probabilityFinishBy en rangos extremos.
 *   - Histograma cubre todos los samples.
 */

import { describe, it, expect } from 'vitest'
import {
  runMonteCarloPortfolio,
  seedRandom,
  probabilityFinishBy,
  type MonteCarloInput,
} from '@/lib/brain/strategist/monte-carlo'

const TODAY = '2026-01-01T00:00:00.000Z'

function daysBetween(aIso: string, bIso: string): number {
  return (
    (new Date(bIso).getTime() - new Date(aIso).getTime()) /
    (1000 * 60 * 60 * 24)
  )
}

describe('runMonteCarloPortfolio · percentil ordering', () => {
  it('produce P10 ≤ P50 ≤ P90 por proyecto y portafolio', () => {
    const input: MonteCarloInput = {
      projects: [
        {
          id: 'p1',
          name: 'Alfa',
          tasks: [
            { id: 't1', projectId: 'p1', durationDaysMean: 10, durationDaysStd: 2 },
            { id: 't2', projectId: 'p1', durationDaysMean: 5, durationDaysStd: 1 },
          ],
        },
        {
          id: 'p2',
          name: 'Beta',
          tasks: [
            { id: 't3', projectId: 'p2', durationDaysMean: 8, durationDaysStd: 1.5 },
          ],
        },
      ],
      crossDeps: [],
      today: TODAY,
    }
    const r = runMonteCarloPortfolio(input, 1000, { rng: seedRandom(42) })
    for (const p of r.projects) {
      const d10 = daysBetween(TODAY, p.p10)
      const d50 = daysBetween(TODAY, p.p50)
      const d90 = daysBetween(TODAY, p.p90)
      expect(d10).toBeLessThanOrEqual(d50)
      expect(d50).toBeLessThanOrEqual(d90)
    }
    expect(daysBetween(TODAY, r.portfolio.totalFinishP10)).toBeLessThanOrEqual(
      daysBetween(TODAY, r.portfolio.totalFinishP50),
    )
    expect(daysBetween(TODAY, r.portfolio.totalFinishP50)).toBeLessThanOrEqual(
      daysBetween(TODAY, r.portfolio.totalFinishP90),
    )
  })
})

describe('runMonteCarloPortfolio · sample size', () => {
  it('respeta el sample size solicitado', () => {
    const input: MonteCarloInput = {
      projects: [
        {
          id: 'p1',
          name: 'Alfa',
          tasks: [
            { id: 't1', projectId: 'p1', durationDaysMean: 10, durationDaysStd: 2 },
          ],
        },
      ],
      crossDeps: [],
      today: TODAY,
    }
    const r = runMonteCarloPortfolio(input, 2500, { rng: seedRandom(123) })
    expect(r.iterations).toBe(2500)
    expect(r.projects[0].samples).toHaveLength(2500)
  })
})

describe('runMonteCarloPortfolio · caso trivial', () => {
  it('std=0 → P50 == mean determinista', () => {
    const input: MonteCarloInput = {
      projects: [
        {
          id: 'p1',
          name: 'Single',
          tasks: [
            { id: 't1', projectId: 'p1', durationDaysMean: 7, durationDaysStd: 0 },
          ],
        },
      ],
      crossDeps: [],
      today: TODAY,
    }
    const r = runMonteCarloPortfolio(input, 500, { rng: seedRandom(7) })
    expect(daysBetween(TODAY, r.projects[0].p50)).toBe(7)
    expect(r.projects[0].meanDays).toBe(7)
    expect(r.projects[0].stdDays).toBe(0)
  })
})

describe('runMonteCarloPortfolio · cross-project dependency', () => {
  it('B depende de A: P50(B) > P50(A) y ~mean(A)+mean(B)', () => {
    const input: MonteCarloInput = {
      projects: [
        {
          id: 'pA',
          name: 'A',
          tasks: [
            { id: 'a1', projectId: 'pA', durationDaysMean: 10, durationDaysStd: 1 },
          ],
        },
        {
          id: 'pB',
          name: 'B',
          tasks: [
            { id: 'b1', projectId: 'pB', durationDaysMean: 5, durationDaysStd: 1 },
          ],
        },
      ],
      crossDeps: [{ predecessorTaskId: 'a1', successorTaskId: 'b1' }],
      today: TODAY,
    }
    const r = runMonteCarloPortfolio(input, 1000, { rng: seedRandom(99) })
    const pA = r.projects.find((p) => p.projectId === 'pA')!
    const pB = r.projects.find((p) => p.projectId === 'pB')!
    expect(daysBetween(TODAY, pB.p50)).toBeGreaterThan(
      daysBetween(TODAY, pA.p50),
    )
    // B debe estar ~mean(a)+mean(b) = 15d ± ruido
    expect(daysBetween(TODAY, pB.p50)).toBeGreaterThanOrEqual(13)
    expect(daysBetween(TODAY, pB.p50)).toBeLessThanOrEqual(17)
  })
})

describe('runMonteCarloPortfolio · determinismo', () => {
  it('misma seed → mismos percentiles', () => {
    const input: MonteCarloInput = {
      projects: [
        {
          id: 'p1',
          name: 'Solo',
          tasks: [
            { id: 't1', projectId: 'p1', durationDaysMean: 12, durationDaysStd: 3 },
            { id: 't2', projectId: 'p1', durationDaysMean: 6, durationDaysStd: 1 },
          ],
        },
      ],
      crossDeps: [],
      today: TODAY,
    }
    const a = runMonteCarloPortfolio(input, 1000, { rng: seedRandom(2026) })
    const b = runMonteCarloPortfolio(input, 1000, { rng: seedRandom(2026) })
    expect(a.projects[0].p50).toBe(b.projects[0].p50)
    expect(a.projects[0].p10).toBe(b.projects[0].p10)
    expect(a.projects[0].p90).toBe(b.projects[0].p90)
    expect(a.portfolio.totalFinishP50).toBe(b.portfolio.totalFinishP50)
  })
})

describe('runMonteCarloPortfolio · ciclos', () => {
  it('rechaza ciclos en cross-deps con [INVALID_INPUT]', () => {
    const input: MonteCarloInput = {
      projects: [
        {
          id: 'p1',
          name: 'Ciclo',
          tasks: [
            { id: 'a', projectId: 'p1', durationDaysMean: 5, durationDaysStd: 0 },
            { id: 'b', projectId: 'p1', durationDaysMean: 5, durationDaysStd: 0 },
          ],
        },
      ],
      crossDeps: [
        { predecessorTaskId: 'a', successorTaskId: 'b' },
        { predecessorTaskId: 'b', successorTaskId: 'a' },
      ],
      today: TODAY,
    }
    expect(() =>
      runMonteCarloPortfolio(input, 100, { rng: seedRandom(1) }),
    ).toThrow(/INVALID_INPUT/)
  })
})

describe('probabilityFinishBy', () => {
  it('0 si target en pasado, ~1 si target lejos en futuro (std=0)', () => {
    const input: MonteCarloInput = {
      projects: [
        {
          id: 'p1',
          name: 'Single',
          tasks: [
            { id: 't1', projectId: 'p1', durationDaysMean: 10, durationDaysStd: 0 },
          ],
        },
      ],
      crossDeps: [],
      today: TODAY,
    }
    const r = runMonteCarloPortfolio(input, 500, { rng: seedRandom(5) })
    expect(probabilityFinishBy(r, '2025-12-01T00:00:00.000Z')).toBe(0)
    expect(probabilityFinishBy(r, '2026-12-31T00:00:00.000Z')).toBe(1)
  })
})

describe('runMonteCarloPortfolio · histograma', () => {
  it('cubre el rango completo de samples', () => {
    const input: MonteCarloInput = {
      projects: [
        {
          id: 'p1',
          name: 'Hist',
          tasks: [
            { id: 't1', projectId: 'p1', durationDaysMean: 20, durationDaysStd: 5 },
          ],
        },
      ],
      crossDeps: [],
      today: TODAY,
    }
    const r = runMonteCarloPortfolio(input, 2000, {
      rng: seedRandom(33),
      histogramBins: 10,
    })
    const h = r.projects[0].histogram
    expect(h.bins).toHaveLength(10)
    const totalCount = h.bins.reduce((a, b) => a + b, 0)
    expect(totalCount).toBe(2000)
    expect(h.max).toBeGreaterThan(h.min)
  })
})
