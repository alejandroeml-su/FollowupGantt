import { describe, it, expect } from 'vitest'
import {
  computeCapacity,
  parseCapacityOverrides,
  dailySlack,
} from '@/lib/resources/capacity-calc'
import { DEFAULT_WORKDAYS_BITMASK } from '@/lib/scheduling/work-calendar'

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('resources/capacity-calc · parseCapacityOverrides', () => {
  it('devuelve {} para inputs no-objeto', () => {
    expect(parseCapacityOverrides(null)).toEqual({})
    expect(parseCapacityOverrides(undefined)).toEqual({})
    expect(parseCapacityOverrides('foo')).toEqual({})
    expect(parseCapacityOverrides(123)).toEqual({})
    expect(parseCapacityOverrides(['a'])).toEqual({})
  })

  it('extrae dailyHours numéricos válidos', () => {
    const input = { 'user-A': { dailyHours: 6 } }
    expect(parseCapacityOverrides(input)).toEqual({
      'user-A': { dailyHours: 6 },
    })
  })

  it('filtra dailyHours negativos', () => {
    const input = { 'user-A': { dailyHours: -3 } }
    expect(parseCapacityOverrides(input)).toEqual({})
  })

  it('extrae lista de off (sólo strings YYYY-MM-DD)', () => {
    const input = {
      'user-A': { off: ['2026-05-01', '2026-05-02', 'invalid', 123] },
    }
    expect(parseCapacityOverrides(input)).toEqual({
      'user-A': { off: ['2026-05-01', '2026-05-02'] },
    })
  })

  it('combina dailyHours + off', () => {
    const input = {
      'user-A': { dailyHours: 4, off: ['2026-05-10'] },
    }
    expect(parseCapacityOverrides(input)).toEqual({
      'user-A': { dailyHours: 4, off: ['2026-05-10'] },
    })
  })

  it('ignora entradas inválidas y conserva válidas', () => {
    const input = {
      'user-A': { dailyHours: 8 },
      'user-B': null,
      'user-C': 'wrong',
      'user-D': { dailyHours: 'no-num' },
    }
    expect(parseCapacityOverrides(input)).toEqual({
      'user-A': { dailyHours: 8 },
    })
  })
})

describe('resources/capacity-calc · computeCapacity', () => {
  it('valida rangeStart <= rangeEnd', () => {
    expect(() =>
      computeCapacity({
        userIds: ['user-A'],
        rangeStart: utc('2026-05-10'),
        rangeEnd: utc('2026-05-01'),
      }),
    ).toThrowError(/INVALID_INPUT/)
  })

  it('asume lun-vie 8h sin calendar', () => {
    // 2026-05-04 es lunes; 2026-05-09 es sábado, 2026-05-10 es domingo.
    const result = computeCapacity({
      userIds: ['user-A'],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-10'),
    })
    const cap = result.byUser[0]?.dailyCapacity
    expect(cap?.get('2026-05-04')).toBe(8) // lunes
    expect(cap?.get('2026-05-08')).toBe(8) // viernes
    expect(cap?.get('2026-05-09')).toBe(0) // sábado
    expect(cap?.get('2026-05-10')).toBe(0) // domingo
  })

  it('respeta calendar custom (ej. lun-jueves)', () => {
    // Bitmask: bit 0=lun, 1=mar, 2=mié, 3=jue, 4=vie. lun-jue = 0b0001111 = 15
    const result = computeCapacity({
      userIds: ['user-A'],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-08'),
      calendar: { workdays: 15, holidays: [] },
    })
    const cap = result.byUser[0]?.dailyCapacity
    expect(cap?.get('2026-05-04')).toBe(8) // lun
    expect(cap?.get('2026-05-07')).toBe(8) // jue
    expect(cap?.get('2026-05-08')).toBe(0) // vie ⇒ no laborable
  })

  it('sobreescribe dailyHours por usuario', () => {
    const result = computeCapacity({
      userIds: ['user-A'],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-04'),
      overrides: { 'user-A': { dailyHours: 4 } },
    })
    expect(result.byUser[0]?.dailyCapacity.get('2026-05-04')).toBe(4)
  })

  it('day en `off` ⇒ capacidad 0 incluso si es laborable', () => {
    const result = computeCapacity({
      userIds: ['user-A'],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-04'),
      overrides: { 'user-A': { off: ['2026-05-04'] } },
    })
    expect(result.byUser[0]?.dailyCapacity.get('2026-05-04')).toBe(0)
  })

  it('totalCapacityHours = suma de horas laborables', () => {
    const result = computeCapacity({
      userIds: ['user-A'],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-08'),
    })
    expect(result.byUser[0]?.totalCapacityHours).toBe(40) // 5 días × 8
    expect(result.byUser[0]?.workingDaysCount).toBe(5)
  })

  it('respeta holidays del calendar', () => {
    const result = computeCapacity({
      userIds: ['user-A'],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-04'),
      calendar: {
        workdays: DEFAULT_WORKDAYS_BITMASK,
        holidays: [{ date: utc('2026-05-04'), recurring: false }],
      },
    })
    expect(result.byUser[0]?.dailyCapacity.get('2026-05-04')).toBe(0)
  })

  it('devuelve días en orden ISO ascendente', () => {
    const result = computeCapacity({
      userIds: ['user-A'],
      rangeStart: utc('2026-05-01'),
      rangeEnd: utc('2026-05-04'),
    })
    expect(result.days).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
      '2026-05-04',
    ])
  })

  it('múltiples usuarios mantienen el orden de userIds', () => {
    const result = computeCapacity({
      userIds: ['user-Z', 'user-A'],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-04'),
    })
    expect(result.byUser.map((u) => u.userId)).toEqual(['user-Z', 'user-A'])
  })
})

describe('resources/capacity-calc · dailySlack', () => {
  it('devuelve capacidad - carga - solicitado', () => {
    expect(dailySlack(8, 4, 2)).toBe(2)
    expect(dailySlack(8, 4)).toBe(4)
    expect(dailySlack(8, 8)).toBe(0)
    expect(dailySlack(8, 12)).toBe(-4)
  })
})
