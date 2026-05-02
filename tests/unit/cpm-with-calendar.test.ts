import { describe, it, expect } from 'vitest'
import { computeCpm, type CpmInput } from '@/lib/scheduling/cpm'
import {
  DEFAULT_WORKDAYS_BITMASK,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'

const PROJECT_START = new Date('2026-05-04T00:00:00Z') // lunes

const monFri: WorkCalendarLike = {
  workdays: DEFAULT_WORKDAYS_BITMASK, // 31
  holidays: [],
}

const monFriWithHoliday: WorkCalendarLike = {
  workdays: DEFAULT_WORKDAYS_BITMASK,
  // 2026-05-12 (martes) es festivo
  holidays: [{ date: new Date('2026-05-12T00:00:00Z'), recurring: false }],
}

describe('computeCpm with calendar (Ola P1.5)', () => {
  it('sin calendar ⇒ comportamiento legacy (días corridos)', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [
        { id: 'A', duration: 5, isMilestone: false },
      ],
      dependencies: [],
    }
    const out = computeCpm(input)
    const a = out.results.get('A')!
    // 5 días corridos desde lunes 4 → sábado 9 (no respeta workdays)
    expect(a.startDate.toISOString().slice(0, 10)).toBe('2026-05-04')
    expect(a.endDate.toISOString().slice(0, 10)).toBe('2026-05-09')
  })

  it('con calendar lun-vie ⇒ duración 5 días empieza lun y termina lun siguiente', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [{ id: 'A', duration: 5, isMilestone: false }],
      dependencies: [],
      calendar: monFri,
    }
    const out = computeCpm(input)
    const a = out.results.get('A')!
    expect(a.startDate.toISOString().slice(0, 10)).toBe('2026-05-04')
    // ES=0 (lunes), EF=5 ⇒ +5 workdays desde lun = lun siguiente (2026-05-11)
    // (que coincide con la semántica de addWorkdays usado en daysToDate)
    expect(a.endDate.toISOString().slice(0, 10)).toBe('2026-05-11')
  })

  it('cadena A(2)→B(3) en lun-vie respeta dependencias en workdays', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [
        { id: 'A', duration: 2, isMilestone: false },
        { id: 'B', duration: 3, isMilestone: false },
      ],
      dependencies: [
        { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
      ],
      calendar: monFri,
    }
    const out = computeCpm(input)
    expect(out.warnings).toEqual([])
    const a = out.results.get('A')!
    const b = out.results.get('B')!
    // A: lun 4 + 2 workdays ⇒ end mié 6
    expect(a.startDate.toISOString().slice(0, 10)).toBe('2026-05-04')
    expect(a.endDate.toISOString().slice(0, 10)).toBe('2026-05-06')
    // B: empieza mié 6 (ES=2) y +3 workdays = lun 11
    expect(b.startDate.toISOString().slice(0, 10)).toBe('2026-05-06')
    expect(b.endDate.toISOString().slice(0, 10)).toBe('2026-05-11')
  })

  it('paralelos A→[B,C]→D respetan workdays', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [
        { id: 'A', duration: 1, isMilestone: false },
        { id: 'B', duration: 2, isMilestone: false },
        { id: 'C', duration: 3, isMilestone: false },
        { id: 'D', duration: 1, isMilestone: false },
      ],
      dependencies: [
        { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
        { predecessorId: 'A', successorId: 'C', type: 'FS', lag: 0 },
        { predecessorId: 'B', successorId: 'D', type: 'FS', lag: 0 },
        { predecessorId: 'C', successorId: 'D', type: 'FS', lag: 0 },
      ],
      calendar: monFri,
    }
    const out = computeCpm(input)
    expect(out.warnings).toEqual([])
    // Ruta crítica = A→C→D (más larga)
    expect(out.criticalPath).toContain('A')
    expect(out.criticalPath).toContain('C')
    expect(out.criticalPath).toContain('D')
    expect(out.projectDuration).toBe(5) // 1+3+1
  })

  it('hito (duration=0) con calendar mantiene fecha de start', () => {
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [
        { id: 'M', duration: 0, isMilestone: true },
      ],
      dependencies: [],
      calendar: monFri,
    }
    const out = computeCpm(input)
    const m = out.results.get('M')!
    expect(m.startDate.toISOString().slice(0, 10)).toBe('2026-05-04')
    expect(m.endDate.toISOString().slice(0, 10)).toBe('2026-05-04')
  })

  it('con holiday en medio, duration efectiva se aplaza un día calendario', () => {
    // Tarea de 5 workdays empezando lun 11 mayo. Mar 12 es festivo,
    // por lo que el end debería caer el lun 18 (no el vie 15).
    const input: CpmInput = {
      projectStart: new Date('2026-05-11T00:00:00Z'),
      tasks: [{ id: 'A', duration: 5, isMilestone: false }],
      dependencies: [],
      calendar: monFriWithHoliday,
    }
    const out = computeCpm(input)
    const a = out.results.get('A')!
    expect(a.startDate.toISOString().slice(0, 10)).toBe('2026-05-11')
    expect(a.endDate.toISOString().slice(0, 10)).toBe('2026-05-19')
  })

  it('duración numérica (CPM units) no cambia con calendar; solo fechas', () => {
    // CPM units = días desde projectStart, ES/EF/LF/LS no se ven afectados.
    const input: CpmInput = {
      projectStart: PROJECT_START,
      tasks: [
        { id: 'A', duration: 3, isMilestone: false },
        { id: 'B', duration: 2, isMilestone: false },
      ],
      dependencies: [
        { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
      ],
      calendar: monFri,
    }
    const out = computeCpm(input)
    expect(out.results.get('A')!.ES).toBe(0)
    expect(out.results.get('A')!.EF).toBe(3)
    expect(out.results.get('B')!.ES).toBe(3)
    expect(out.results.get('B')!.EF).toBe(5)
  })
})
