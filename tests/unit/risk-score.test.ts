import { describe, it, expect } from 'vitest'
import {
  computeRiskScore,
  evaluateRisk,
  tierFromScore,
} from '@/lib/risks/risk-score'

/**
 * Wave P8 · Equipo P8-2 — Tests del scoring de riesgos.
 *
 * Valida la matriz PMBOK 5×5:
 *   - Score = probability × impact ∈ [1, 25]
 *   - Tiers:  1-4 LOW · 5-10 MEDIUM · 11-16 HIGH · 17-25 CRITICAL
 */

describe('computeRiskScore', () => {
  it('1×1 = 1', () => {
    expect(computeRiskScore(1, 1)).toBe(1)
  })

  it('5×5 = 25 (máximo)', () => {
    expect(computeRiskScore(5, 5)).toBe(25)
  })

  it('3×4 = 12 (intermedio)', () => {
    expect(computeRiskScore(3, 4)).toBe(12)
  })

  it('lanza error con probability fuera de rango (0)', () => {
    expect(() => computeRiskScore(0, 3)).toThrow(/INVALID_PROBABILITY/)
  })

  it('lanza error con impact fuera de rango (6)', () => {
    expect(() => computeRiskScore(2, 6)).toThrow(/INVALID_IMPACT/)
  })

  it('lanza error con probability no entero (2.5)', () => {
    expect(() => computeRiskScore(2.5, 3)).toThrow(/INVALID_PROBABILITY/)
  })

  it('lanza error con impact negativo', () => {
    expect(() => computeRiskScore(3, -1)).toThrow(/INVALID_IMPACT/)
  })
})

describe('tierFromScore', () => {
  it('score 1 → LOW', () => expect(tierFromScore(1)).toBe('LOW'))
  it('score 4 → LOW (límite superior)', () =>
    expect(tierFromScore(4)).toBe('LOW'))
  it('score 5 → MEDIUM (límite inferior)', () =>
    expect(tierFromScore(5)).toBe('MEDIUM'))
  it('score 10 → MEDIUM (límite superior)', () =>
    expect(tierFromScore(10)).toBe('MEDIUM'))
  it('score 11 → HIGH (límite inferior)', () =>
    expect(tierFromScore(11)).toBe('HIGH'))
  it('score 16 → HIGH (límite superior)', () =>
    expect(tierFromScore(16)).toBe('HIGH'))
  it('score 17 → CRITICAL (límite inferior)', () =>
    expect(tierFromScore(17)).toBe('CRITICAL'))
  it('score 25 → CRITICAL (máximo)', () =>
    expect(tierFromScore(25)).toBe('CRITICAL'))

  it('score 0 (degenerado) → LOW', () => expect(tierFromScore(0)).toBe('LOW'))

  it('score NaN (degenerado) → LOW', () =>
    expect(tierFromScore(Number.NaN)).toBe('LOW'))
})

describe('evaluateRisk · matriz completa', () => {
  it('todas las celdas LOW: 1×1 .. 1×4, 2×1, 2×2, 4×1', () => {
    const lowCells: Array<[number, number]> = [
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 1],
      [2, 2],
      [4, 1],
    ]
    for (const [p, i] of lowCells) {
      expect(evaluateRisk(p as 1 | 2 | 3 | 4 | 5, i as 1 | 2 | 3 | 4 | 5).tier).toBe('LOW')
    }
  })

  it('celdas CRITICAL: 4×5, 5×4, 5×5', () => {
    expect(evaluateRisk(4, 5).tier).toBe('CRITICAL')
    expect(evaluateRisk(5, 4).tier).toBe('CRITICAL')
    expect(evaluateRisk(5, 5).tier).toBe('CRITICAL')
  })

  it('celda HIGH típica (3×4 = 12)', () => {
    const r = evaluateRisk(3, 4)
    expect(r.score).toBe(12)
    expect(r.tier).toBe('HIGH')
  })

  it('celda MEDIUM frontera inferior (1×5 = 5)', () => {
    const r = evaluateRisk(1, 5)
    expect(r.score).toBe(5)
    expect(r.tier).toBe('MEDIUM')
  })

  it('toda la matriz produce tiers monotónicamente no-decrecientes en filas', () => {
    // Fija probability=3, varía impact 1..5: tiers ascendentes.
    const tiers = [1, 2, 3, 4, 5].map((i) => evaluateRisk(3, i as 1 | 2 | 3 | 4 | 5).tier)
    // Debe ser monotónico no-decreciente.
    const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    for (let i = 1; i < tiers.length; i++) {
      expect(order.indexOf(tiers[i])).toBeGreaterThanOrEqual(
        order.indexOf(tiers[i - 1]),
      )
    }
  })
})
