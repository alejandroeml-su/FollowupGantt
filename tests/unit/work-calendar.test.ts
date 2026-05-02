import { describe, it, expect } from 'vitest'
import {
  isWorkday,
  nextWorkday,
  addWorkdays,
  workdaysBetween,
  endDateFromDuration,
  startOfDayUTC,
  DEFAULT_WORKDAYS_BITMASK,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'

const monFri: WorkCalendarLike = {
  workdays: DEFAULT_WORKDAYS_BITMASK, // 31 = lun-vie
  holidays: [],
}

const monFriWithHoliday: WorkCalendarLike = {
  workdays: DEFAULT_WORKDAYS_BITMASK,
  holidays: [
    { date: new Date('2026-05-05T00:00:00Z'), recurring: false },
    { date: new Date('2024-12-25T00:00:00Z'), recurring: true }, // Navidad cualquier año
  ],
}

const allDays: WorkCalendarLike = {
  // 0b1111111 = 127 → todos los días son laborables
  workdays: 127,
  holidays: [],
}

describe('work-calendar', () => {
  describe('isWorkday', () => {
    it('lunes laborable es workday en lun-vie', () => {
      // 2026-05-04 es lunes
      expect(isWorkday(new Date('2026-05-04T00:00:00Z'), monFri)).toBe(true)
    })

    it('sábado/domingo no son workdays en lun-vie', () => {
      // 2026-05-02 sábado, 2026-05-03 domingo
      expect(isWorkday(new Date('2026-05-02T00:00:00Z'), monFri)).toBe(false)
      expect(isWorkday(new Date('2026-05-03T00:00:00Z'), monFri)).toBe(false)
    })

    it('holiday no-recurrente bloquea el día exacto', () => {
      // 2026-05-05 es martes pero está en holidays exact
      expect(
        isWorkday(new Date('2026-05-05T00:00:00Z'), monFriWithHoliday),
      ).toBe(false)
      // 2026-05-04 (lunes) sigue siendo workday
      expect(
        isWorkday(new Date('2026-05-04T00:00:00Z'), monFriWithHoliday),
      ).toBe(true)
    })

    it('holiday recurring bloquea cualquier año (mismo mes/día)', () => {
      // Navidad cualquier año (recurring=true). 2027-12-25 es sábado igual
      // pero también es el holiday recurring; verificamos un día que sí sería
      // workday: 2027-12-27 (lunes) NO debería estar bloqueado.
      expect(
        isWorkday(new Date('2030-12-25T00:00:00Z'), monFriWithHoliday),
      ).toBe(false)
      expect(
        isWorkday(new Date('2027-12-27T00:00:00Z'), monFriWithHoliday),
      ).toBe(true)
    })
  })

  describe('nextWorkday', () => {
    it('desde viernes salta al lunes', () => {
      // 2026-05-08 viernes → 2026-05-11 lunes
      const r = nextWorkday(new Date('2026-05-08T00:00:00Z'), monFri)
      expect(r.toISOString().slice(0, 10)).toBe('2026-05-11')
    })

    it('siempre devuelve estrictamente posterior', () => {
      // 2026-05-04 es lunes laborable; nextWorkday → martes
      const r = nextWorkday(new Date('2026-05-04T00:00:00Z'), monFri)
      expect(r.toISOString().slice(0, 10)).toBe('2026-05-05')
    })
  })

  describe('addWorkdays', () => {
    it('+5 workdays desde lunes salta el fin de semana', () => {
      // 2026-05-04 lunes + 5 workdays = 2026-05-11 lunes siguiente
      const r = addWorkdays(new Date('2026-05-04T00:00:00Z'), 5, monFri)
      expect(r.toISOString().slice(0, 10)).toBe('2026-05-11')
    })

    it('días=0 devuelve la misma fecha (normalizada)', () => {
      const r = addWorkdays(new Date('2026-05-04T15:30:00Z'), 0, monFri)
      expect(r.toISOString()).toBe('2026-05-04T00:00:00.000Z')
    })

    it('+3 workdays con holiday en medio salta', () => {
      // 2026-05-04 lunes + 3 workdays = mar 5, mié 6, jue 7
      // Pero mar 5 es holiday → workdays cuentan: mié 6, jue 7, vie 8
      const r = addWorkdays(new Date('2026-05-04T00:00:00Z'), 3, monFriWithHoliday)
      expect(r.toISOString().slice(0, 10)).toBe('2026-05-08')
    })

    it('calendar 24/7 ⇒ +5 días = +5 corridos', () => {
      const r = addWorkdays(new Date('2026-05-01T00:00:00Z'), 5, allDays)
      expect(r.toISOString().slice(0, 10)).toBe('2026-05-06')
    })
  })

  describe('workdaysBetween', () => {
    it('lunes a lunes próxima semana = 5 workdays', () => {
      const r = workdaysBetween(
        new Date('2026-05-04T00:00:00Z'),
        new Date('2026-05-11T00:00:00Z'),
        monFri,
      )
      expect(r).toBe(5)
    })

    it('mismo día = 0', () => {
      const r = workdaysBetween(
        new Date('2026-05-04T00:00:00Z'),
        new Date('2026-05-04T23:00:00Z'),
        monFri,
      )
      expect(r).toBe(0)
    })

    it('con holiday descuenta el día', () => {
      // lun 4 → lun 11 son 5 workdays normalmente; mar 5 es holiday → 4
      const r = workdaysBetween(
        new Date('2026-05-04T00:00:00Z'),
        new Date('2026-05-11T00:00:00Z'),
        monFriWithHoliday,
      )
      expect(r).toBe(4)
    })
  })

  describe('endDateFromDuration', () => {
    it('duration=1 desde lunes laborable = mismo día', () => {
      // PMI: duration=1 ⇒ 1 día de trabajo, end = start (si start es workday)
      const r = endDateFromDuration(new Date('2026-05-04T00:00:00Z'), 1, monFri)
      expect(r.toISOString().slice(0, 10)).toBe('2026-05-04')
    })

    it('duration=5 desde lunes = viernes (1 semana laboral)', () => {
      const r = endDateFromDuration(new Date('2026-05-04T00:00:00Z'), 5, monFri)
      expect(r.toISOString().slice(0, 10)).toBe('2026-05-08')
    })

    it('start no laborable ⇒ avanza al primer workday', () => {
      // sábado 2026-05-02 + duration=1 ⇒ lunes 2026-05-04
      const r = endDateFromDuration(new Date('2026-05-02T00:00:00Z'), 1, monFri)
      expect(r.toISOString().slice(0, 10)).toBe('2026-05-04')
    })
  })

  describe('startOfDayUTC', () => {
    it('elimina hora/min/seg/ms', () => {
      const r = startOfDayUTC(new Date('2026-05-04T15:30:45.123Z'))
      expect(r.toISOString()).toBe('2026-05-04T00:00:00.000Z')
    })
  })
})
