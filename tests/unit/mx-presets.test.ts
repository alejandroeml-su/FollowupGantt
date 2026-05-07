import { describe, it, expect } from 'vitest'
import {
  MX_HOLIDAYS_FIXED,
  buildMxAllHolidayRows,
  buildMxFixedHolidayRows,
  buildMxMovableHolidayRows,
} from '@/lib/calendar/mx-presets'

describe('mx-presets · MX_HOLIDAYS_FIXED', () => {
  it('expone 4 holidays fijos por mes/día', () => {
    expect(MX_HOLIDAYS_FIXED).toHaveLength(4)
    const ids = MX_HOLIDAYS_FIXED.map((h) => h.monthDay)
    expect(ids).toContain('01-01')
    expect(ids).toContain('05-01')
    expect(ids).toContain('09-16')
    expect(ids).toContain('12-25')
  })
})

describe('mx-presets · buildMxFixedHolidayRows', () => {
  it('genera 4 filas para un año dado', () => {
    const rows = buildMxFixedHolidayRows(2026)
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.recurring).toBe(true)
      expect(r.date.getUTCFullYear()).toBe(2026)
    }
  })

  it('Año Nuevo cae en 2026-01-01', () => {
    const rows = buildMxFixedHolidayRows(2026)
    const newYear = rows.find((r) => r.name === 'Año Nuevo')
    expect(newYear?.date.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('mx-presets · buildMxMovableHolidayRows', () => {
  it('genera 3 filas con recurring=false', () => {
    const rows = buildMxMovableHolidayRows(2026)
    expect(rows).toHaveLength(3)
    for (const r of rows) expect(r.recurring).toBe(false)
  })

  it('1er lunes de febrero 2026 es 2026-02-02', () => {
    // 2026-02-01 es domingo → primer lunes = 2026-02-02
    const rows = buildMxMovableHolidayRows(2026)
    const constitution = rows.find((r) => r.name === 'Día de la Constitución')
    expect(constitution?.date.toISOString()).toBe('2026-02-02T00:00:00.000Z')
  })

  it('3er lunes de marzo 2026 es 2026-03-16', () => {
    // 2026-03-01 es domingo, primer lunes = 2 mar, 3er lunes = 16 mar
    const rows = buildMxMovableHolidayRows(2026)
    const juarez = rows.find((r) => r.name === 'Natalicio de Benito Juárez')
    expect(juarez?.date.toISOString()).toBe('2026-03-16T00:00:00.000Z')
  })

  it('3er lunes de noviembre 2026 es 2026-11-16', () => {
    const rows = buildMxMovableHolidayRows(2026)
    const rev = rows.find((r) => r.name === 'Día de la Revolución Mexicana')
    expect(rev?.date.toISOString()).toBe('2026-11-16T00:00:00.000Z')
  })

  it('cambia con el año (control 2025: 1er lun feb = 2025-02-03)', () => {
    const rows = buildMxMovableHolidayRows(2025)
    // 2025-02-01 es sábado → 1er lunes = 2025-02-03
    const constitution = rows.find((r) => r.name === 'Día de la Constitución')
    expect(constitution?.date.toISOString()).toBe('2025-02-03T00:00:00.000Z')
  })
})

describe('mx-presets · buildMxAllHolidayRows', () => {
  it('combina fijos + movibles = 7 filas', () => {
    expect(buildMxAllHolidayRows(2026)).toHaveLength(7)
  })
})
