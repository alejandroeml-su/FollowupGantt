import { describe, it, expect } from 'vitest'

/**
 * Ola P2 · Equipo P2-3 — Tests del helper RRULE.
 *
 * Cubre frecuencias DAILY/WEEKLY/MONTHLY/YEARLY, byweekday, bymonthday,
 * count, endDate y validaciones. Sin BD: el helper es puro.
 */

import {
  validateRule,
  expandOccurrences,
  nextOccurrence,
  previewOccurrences,
  hasFutureOccurrences,
  type RRule,
} from '@/lib/recurrence/rrule'

const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('validateRule', () => {
  it('acepta una regla mínima válida', () => {
    const v = validateRule({
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
    })
    expect(v.ok).toBe(true)
  })

  it('rechaza interval < 1', () => {
    const v = validateRule({
      frequency: 'DAILY',
      interval: 0,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
    })
    expect(v.ok).toBe(false)
  })

  it('rechaza endDate previa a startDate', () => {
    const v = validateRule({
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-10'),
      endDate: utcDate('2026-05-01'),
    })
    expect(v.ok).toBe(false)
  })

  it('rechaza byweekday con frequency != WEEKLY', () => {
    const v = validateRule({
      frequency: 'DAILY',
      interval: 1,
      byweekday: [0, 2],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
    })
    expect(v.ok).toBe(false)
  })

  it('rechaza bymonthday inválido (>31)', () => {
    const v = validateRule({
      frequency: 'MONTHLY',
      interval: 1,
      byweekday: [],
      bymonthday: [35],
      startDate: utcDate('2026-05-01'),
    })
    expect(v.ok).toBe(false)
  })
})

describe('expandOccurrences · DAILY', () => {
  it('expande cada día con count=5', () => {
    const rule: RRule = {
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
      count: 5,
    }
    const out = expandOccurrences(rule, utcDate('2026-12-31'))
    expect(out).toHaveLength(5)
    expect(out[0].toISOString().slice(0, 10)).toBe('2026-05-01')
    expect(out[4].toISOString().slice(0, 10)).toBe('2026-05-05')
  })

  it('respeta interval=2 (cada 2 días)', () => {
    const rule: RRule = {
      frequency: 'DAILY',
      interval: 2,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
      count: 3,
    }
    const out = expandOccurrences(rule, utcDate('2026-12-31'))
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-05-01',
      '2026-05-03',
      '2026-05-05',
    ])
  })

  it('se detiene en endDate', () => {
    const rule: RRule = {
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
      endDate: utcDate('2026-05-03'),
    }
    const out = expandOccurrences(rule, utcDate('2026-12-31'))
    expect(out).toHaveLength(3)
    expect(out[2].toISOString().slice(0, 10)).toBe('2026-05-03')
  })
})

describe('expandOccurrences · WEEKLY', () => {
  // 2026-05-01 = viernes (ISO weekday 5 → en nuestro mapa 4)
  it('default sin byweekday: una vez por semana en el weekday del start', () => {
    const rule: RRule = {
      frequency: 'WEEKLY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'), // viernes
      count: 3,
    }
    const out = expandOccurrences(rule, utcDate('2026-12-31'))
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-05-01',
      '2026-05-08',
      '2026-05-15',
    ])
  })

  it('byweekday lun y mié, interval=1', () => {
    const rule: RRule = {
      frequency: 'WEEKLY',
      interval: 1,
      byweekday: [0, 2], // Lun, Mié
      bymonthday: [],
      startDate: utcDate('2026-05-04'), // Lunes 2026-05-04
      count: 4,
    }
    const out = expandOccurrences(rule, utcDate('2026-12-31'))
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-05-04',
      '2026-05-06',
      '2026-05-11',
      '2026-05-13',
    ])
  })

  it('interval=2 con byweekday lun', () => {
    const rule: RRule = {
      frequency: 'WEEKLY',
      interval: 2,
      byweekday: [0],
      bymonthday: [],
      startDate: utcDate('2026-05-04'),
      count: 3,
    }
    const out = expandOccurrences(rule, utcDate('2026-12-31'))
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-05-04',
      '2026-05-18',
      '2026-06-01',
    ])
  })
})

describe('expandOccurrences · MONTHLY', () => {
  it('mismo día del mes que startDate', () => {
    const rule: RRule = {
      frequency: 'MONTHLY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-15'),
      count: 3,
    }
    const out = expandOccurrences(rule, utcDate('2027-12-31'))
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-05-15',
      '2026-06-15',
      '2026-07-15',
    ])
  })

  it('bymonthday=[1,15] genera 2 por mes', () => {
    const rule: RRule = {
      frequency: 'MONTHLY',
      interval: 1,
      byweekday: [],
      bymonthday: [1, 15],
      startDate: utcDate('2026-05-01'),
      count: 4,
    }
    const out = expandOccurrences(rule, utcDate('2027-12-31'))
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-05-01',
      '2026-05-15',
      '2026-06-01',
      '2026-06-15',
    ])
  })

  it('bymonthday=31 salta meses sin día 31', () => {
    const rule: RRule = {
      frequency: 'MONTHLY',
      interval: 1,
      byweekday: [],
      bymonthday: [31],
      startDate: utcDate('2026-01-31'),
      count: 4,
    }
    const out = expandOccurrences(rule, utcDate('2027-12-31'))
    // Enero, Marzo, Mayo, Julio (febrero, abril, junio sin 31).
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ])
  })
})

describe('expandOccurrences · YEARLY', () => {
  it('respeta el día y mes del startDate, count=3', () => {
    const rule: RRule = {
      frequency: 'YEARLY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
      count: 3,
    }
    const out = expandOccurrences(rule, utcDate('2030-12-31'))
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-05-01',
      '2027-05-01',
      '2028-05-01',
    ])
  })
})

describe('nextOccurrence / previewOccurrences', () => {
  it('nextOccurrence devuelve la siguiente estricta a `after`', () => {
    const rule: RRule = {
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
      count: 30,
    }
    const next = nextOccurrence(rule, utcDate('2026-05-03'))
    expect(next?.toISOString().slice(0, 10)).toBe('2026-05-04')
  })

  it('nextOccurrence retorna null cuando la regla expiró', () => {
    const rule: RRule = {
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
      endDate: utcDate('2026-05-05'),
    }
    expect(nextOccurrence(rule, utcDate('2026-05-10'))).toBeNull()
  })

  it('previewOccurrences limita a `max`', () => {
    const rule: RRule = {
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
      count: 100,
    }
    expect(previewOccurrences(rule, 5)).toHaveLength(5)
  })

  it('hasFutureOccurrences refleja terminación por count', () => {
    const rule: RRule = {
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: utcDate('2026-05-01'),
      count: 2,
    }
    expect(hasFutureOccurrences(rule, utcDate('2026-04-01'))).toBe(true)
    expect(hasFutureOccurrences(rule, utcDate('2026-05-02'))).toBe(false)
  })
})
