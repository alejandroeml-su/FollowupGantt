import { describe, it, expect } from 'vitest'
import {
  availableHoursForUser,
  findBlockingAvailability,
  totalAvailableHoursInRange,
  type UserAvailabilityLike,
} from '@/lib/scheduling/user-availability'
import type { WorkCalendarLike } from '@/lib/scheduling/work-calendar'

const MON_TO_FRI: WorkCalendarLike = { workdays: 0b0011111, holidays: [] }

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('user-availability · findBlockingAvailability', () => {
  it('null cuando no hay bloques', () => {
    expect(findBlockingAvailability(utc('2026-06-01'), [])).toBeNull()
  })

  it('encuentra bloque que cubre la fecha', () => {
    const blocks: UserAvailabilityLike[] = [
      {
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        reason: 'VACATION',
      },
    ]
    expect(findBlockingAvailability(utc('2026-06-03'), blocks)).not.toBeNull()
  })

  it('null si la fecha está fuera del rango', () => {
    const blocks: UserAvailabilityLike[] = [
      {
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        reason: 'VACATION',
      },
    ]
    expect(findBlockingAvailability(utc('2026-06-10'), blocks)).toBeNull()
  })

  it('cuando 2 bloques solapan, gana el más restrictivo', () => {
    const blocks: UserAvailabilityLike[] = [
      {
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-10'),
        reason: 'REDUCED_HOURS',
        reducedHoursPercent: 50,
      },
      {
        startDate: utc('2026-06-03'),
        endDate: utc('2026-06-05'),
        reason: 'VACATION',
        // reducedHoursPercent omitido → bloque completo
      },
    ]
    const w = findBlockingAvailability(utc('2026-06-04'), blocks)
    expect(w?.reason).toBe('VACATION')
  })
})

describe('user-availability · availableHoursForUser', () => {
  it('0 horas si el día no es laborable (sábado)', () => {
    // 2026-06-06 es sábado
    expect(availableHoursForUser(utc('2026-06-06'), MON_TO_FRI, [])).toBe(0)
  })

  it('jornada estándar (8h) si día laborable y sin bloques', () => {
    // 2026-06-01 es lunes
    expect(availableHoursForUser(utc('2026-06-01'), MON_TO_FRI, [])).toBe(8)
  })

  it('0 horas si hay bloque completo (vacación)', () => {
    const blocks: UserAvailabilityLike[] = [
      {
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        reason: 'VACATION',
      },
    ]
    expect(availableHoursForUser(utc('2026-06-03'), MON_TO_FRI, blocks)).toBe(0)
  })

  it('horas reducidas si reducedHoursPercent=50', () => {
    const blocks: UserAvailabilityLike[] = [
      {
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-30'),
        reason: 'REDUCED_HOURS',
        reducedHoursPercent: 50,
      },
    ]
    expect(availableHoursForUser(utc('2026-06-03'), MON_TO_FRI, blocks)).toBe(4)
  })

  it('clamp percent fuera de [0,100]', () => {
    const blocks: UserAvailabilityLike[] = [
      {
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-30'),
        reason: 'REDUCED_HOURS',
        reducedHoursPercent: 150,
      },
    ]
    expect(availableHoursForUser(utc('2026-06-03'), MON_TO_FRI, blocks)).toBe(8)
  })

  it('honra standardHours custom (jornada de 6h)', () => {
    expect(
      availableHoursForUser(utc('2026-06-01'), MON_TO_FRI, [], 6),
    ).toBe(6)
  })
})

describe('user-availability · totalAvailableHoursInRange', () => {
  it('0 si from > to', () => {
    expect(
      totalAvailableHoursInRange(
        utc('2026-06-10'),
        utc('2026-06-05'),
        MON_TO_FRI,
        [],
      ),
    ).toBe(0)
  })

  it('semana lun-vie completa = 40h sin bloques', () => {
    // lun 2026-06-01 → vie 2026-06-05
    expect(
      totalAvailableHoursInRange(
        utc('2026-06-01'),
        utc('2026-06-05'),
        MON_TO_FRI,
        [],
      ),
    ).toBe(40)
  })

  it('descuenta correctamente vacación de mitad de semana', () => {
    const blocks: UserAvailabilityLike[] = [
      {
        startDate: utc('2026-06-03'),
        endDate: utc('2026-06-04'),
        reason: 'VACATION',
      },
    ]
    // Lun(8) + Mar(8) + Mié(0) + Jue(0) + Vie(8) = 24h
    expect(
      totalAvailableHoursInRange(
        utc('2026-06-01'),
        utc('2026-06-05'),
        MON_TO_FRI,
        blocks,
      ),
    ).toBe(24)
  })

  it('combina holidays calendario + vacaciones usuario', () => {
    const cal: WorkCalendarLike = {
      workdays: 0b0011111,
      holidays: [{ date: utc('2026-06-02'), recurring: false }], // martes feriado
    }
    const blocks: UserAvailabilityLike[] = [
      {
        startDate: utc('2026-06-04'),
        endDate: utc('2026-06-04'),
        reason: 'SICK',
      },
    ]
    // Lun(8) + Mar(0:holiday) + Mié(8) + Jue(0:sick) + Vie(8) = 24h
    expect(
      totalAvailableHoursInRange(
        utc('2026-06-01'),
        utc('2026-06-05'),
        cal,
        blocks,
      ),
    ).toBe(24)
  })

  it('respeta jornada custom de 6h', () => {
    // 5 días lun-vie × 6h = 30h
    expect(
      totalAvailableHoursInRange(
        utc('2026-06-01'),
        utc('2026-06-05'),
        MON_TO_FRI,
        [],
        6,
      ),
    ).toBe(30)
  })
})
