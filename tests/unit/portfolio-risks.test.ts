import { describe, it, expect } from 'vitest'
import { severityFromScore } from '@/lib/portfolio/risks'

describe('portfolio-risks · severityFromScore', () => {
  it('LOW para scores 1-5', () => {
    expect(severityFromScore(1)).toBe('LOW')
    expect(severityFromScore(3)).toBe('LOW')
    expect(severityFromScore(5)).toBe('LOW')
  })

  it('MEDIUM para scores 6-11', () => {
    expect(severityFromScore(6)).toBe('MEDIUM')
    expect(severityFromScore(8)).toBe('MEDIUM')
    expect(severityFromScore(11)).toBe('MEDIUM')
  })

  it('HIGH para scores 12-25', () => {
    expect(severityFromScore(12)).toBe('HIGH')
    expect(severityFromScore(20)).toBe('HIGH')
    expect(severityFromScore(25)).toBe('HIGH')
  })

  it('thresholds exactos', () => {
    // Justo al borde: 5 = LOW, 6 = MEDIUM, 11 = MEDIUM, 12 = HIGH
    expect(severityFromScore(5)).toBe('LOW')
    expect(severityFromScore(6)).toBe('MEDIUM')
    expect(severityFromScore(11)).toBe('MEDIUM')
    expect(severityFromScore(12)).toBe('HIGH')
  })

  it('combinaciones PMBOK 5×5 reales', () => {
    expect(severityFromScore(5 * 5)).toBe('HIGH') // 25 — máximo
    expect(severityFromScore(4 * 3)).toBe('HIGH') // 12 — alto típico
    expect(severityFromScore(3 * 3)).toBe('MEDIUM') // 9
    expect(severityFromScore(2 * 2)).toBe('LOW') // 4
    expect(severityFromScore(1 * 1)).toBe('LOW') // 1 — mínimo
  })
})
