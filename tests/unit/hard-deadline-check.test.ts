import { describe, it, expect } from 'vitest'
import {
  computeExtendedCpm,
  type ExtendedCpmInput,
} from '@/lib/scheduling/cpm-extended'
import {
  checkHardDeadlines,
  summarizeHardDeadlineCheck,
} from '@/lib/scheduling/hard-deadline-check'
import {
  DEFAULT_WORKDAYS_BITMASK,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'

const PROJECT_START = new Date('2026-05-04T00:00:00Z') // lunes

const monFri: WorkCalendarLike = {
  workdays: DEFAULT_WORKDAYS_BITMASK,
  holidays: [],
}

function buildInput(
  tasks: ExtendedCpmInput['tasks'],
  dependencies: ExtendedCpmInput['dependencies'] = [],
  calendar?: WorkCalendarLike,
): ExtendedCpmInput {
  return { projectStart: PROJECT_START, tasks, dependencies, calendar }
}

describe('checkHardDeadlines', () => {
  it('tarea sin hardDeadline → no aparece en ningún bucket', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        { id: 'A', duration: 3, isMilestone: false },
      ]),
    )
    const r = checkHardDeadlines(cpm)
    expect(r.violations).toHaveLength(0)
    expect(r.warnings).toHaveLength(0)
    expect(r.safe).toHaveLength(0)
  })

  it('hardDeadline lejos en el futuro → safe', () => {
    const hd = new Date('2026-12-31T00:00:00Z')
    const cpm = computeExtendedCpm(
      buildInput([
        { id: 'A', duration: 3, isMilestone: false, hardDeadline: hd },
      ]),
    )
    const r = checkHardDeadlines(cpm)
    expect(r.violations).toHaveLength(0)
    expect(r.warnings).toHaveLength(0)
    expect(r.safe).toHaveLength(1)
    expect(r.safe[0].taskId).toBe('A')
    expect(r.safe[0].slackDays).toBeGreaterThan(0)
  })

  it('hardDeadline antes que EF → violation con slack negativo', () => {
    const hd = new Date('2026-05-04T00:00:00Z') // mismo día que projectStart, EF=3
    const cpm = computeExtendedCpm(
      buildInput([
        { id: 'A', duration: 3, isMilestone: false, hardDeadline: hd },
      ]),
    )
    const r = checkHardDeadlines(cpm)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].slackDays).toBeLessThan(0)
  })

  it('hardDeadline igual a EF → warning (slack=0 < 1)', () => {
    // EF = projectStart + 3 días corridos = 2026-05-07
    const hd = new Date('2026-05-07T00:00:00Z')
    const cpm = computeExtendedCpm(
      buildInput([
        { id: 'A', duration: 3, isMilestone: false, hardDeadline: hd },
      ]),
    )
    const r = checkHardDeadlines(cpm)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].slackDays).toBe(0)
  })

  it('hardDeadline a 1 día corrido → safe', () => {
    const hd = new Date('2026-05-08T00:00:00Z')
    const cpm = computeExtendedCpm(
      buildInput([
        { id: 'A', duration: 3, isMilestone: false, hardDeadline: hd },
      ]),
    )
    const r = checkHardDeadlines(cpm)
    expect(r.safe).toHaveLength(1)
    expect(r.safe[0].slackDays).toBe(1)
  })

  it('múltiples tareas: clasifica a cada una en su bucket', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-05-04T00:00:00Z'), // violation
        },
        {
          id: 'B',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-05-07T00:00:00Z'), // warning (=EF)
        },
        {
          id: 'C',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-12-31T00:00:00Z'), // safe
        },
      ]),
    )
    const r = checkHardDeadlines(cpm)
    expect(r.violations.map((v) => v.taskId)).toEqual(['A'])
    expect(r.warnings.map((v) => v.taskId)).toEqual(['B'])
    expect(r.safe.map((v) => v.taskId)).toEqual(['C'])
  })

  it('determinismo: ejecuciones repetidas devuelven mismo orden', () => {
    const tasks: ExtendedCpmInput['tasks'] = [
      {
        id: 'C',
        duration: 3,
        isMilestone: false,
        hardDeadline: new Date('2026-05-04T00:00:00Z'),
      },
      {
        id: 'A',
        duration: 3,
        isMilestone: false,
        hardDeadline: new Date('2026-05-04T00:00:00Z'),
      },
      {
        id: 'B',
        duration: 3,
        isMilestone: false,
        hardDeadline: new Date('2026-05-04T00:00:00Z'),
      },
    ]
    const cpm = computeExtendedCpm(buildInput(tasks))
    const r1 = checkHardDeadlines(cpm)
    const r2 = checkHardDeadlines(cpm)
    expect(r1.violations.map((v) => v.taskId)).toEqual(['A', 'B', 'C'])
    expect(r1.violations.map((v) => v.taskId)).toEqual(
      r2.violations.map((v) => v.taskId),
    )
  })

  it('con calendar laboral: usa workdays para el slack', () => {
    // Tarea de duración 1 desde lunes 4 ⇒ EF cae martes 5 (daysToDate
    // suma 1 workday). hardDeadline el martes mismo ⇒ slack=0 → warning.
    const hd = new Date('2026-05-05T00:00:00Z')
    const cpm = computeExtendedCpm(
      buildInput(
        [{ id: 'A', duration: 1, isMilestone: false, hardDeadline: hd }],
        [],
        monFri,
      ),
    )
    const r = checkHardDeadlines(cpm, monFri)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].slackDays).toBe(0)
  })

  it('con calendar laboral: weekend no cuenta como slack', () => {
    // Tarea termina viernes 2026-05-08; hardDeadline = sábado 9.
    // workdaysBetween(viernes, sábado) = 0 (sábado no es workday).
    // Como diff inclusive: workdaysBetween(F, Sat) cuenta el sábado solo si es workday.
    const cpm = computeExtendedCpm(
      buildInput(
        [
          {
            id: 'A',
            duration: 5,
            isMilestone: false,
            hardDeadline: new Date('2026-05-09T00:00:00Z'),
          },
        ],
        [],
        monFri,
      ),
    )
    const r = checkHardDeadlines(cpm, monFri)
    // EF al 5to workday = lunes 11. Hard = sábado 9. Slack negativo.
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].slackDays).toBeLessThanOrEqual(0)
  })

  it('hardDeadline en cadena de dependencias (FS): se reporta al sucesor', () => {
    const cpm = computeExtendedCpm(
      buildInput(
        [
          { id: 'A', duration: 3, isMilestone: false },
          {
            id: 'B',
            duration: 3,
            isMilestone: false,
            hardDeadline: new Date('2026-05-08T00:00:00Z'),
          },
        ],
        [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 }],
      ),
    )
    const r = checkHardDeadlines(cpm)
    // EF(B) = 6, hard = +4 días corridos → violation o warning según el delta exacto
    expect(r.violations.length + r.warnings.length).toBe(1)
  })

  it('summarize: cuenta correctamente totales por bucket', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'A',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-05-04T00:00:00Z'),
        },
        {
          id: 'B',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-05-07T00:00:00Z'),
        },
        {
          id: 'C',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-12-31T00:00:00Z'),
        },
        { id: 'D', duration: 1, isMilestone: false }, // sin hardDeadline
      ]),
    )
    const r = checkHardDeadlines(cpm)
    const sum = summarizeHardDeadlineCheck(r)
    expect(sum.totalWithDeadline).toBe(3)
    expect(sum.violationCount).toBe(1)
    expect(sum.warningCount).toBe(1)
  })

  it('milestones (duration=0) con hardDeadline también se chequean', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        {
          id: 'M',
          duration: 0,
          isMilestone: true,
          hardDeadline: new Date('2026-05-04T00:00:00Z'),
        },
      ]),
    )
    const r = checkHardDeadlines(cpm)
    // EF=0 → projectStart, hard = projectStart, slack=0 → warning.
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].taskId).toBe('M')
  })

  it('grafo con ciclo: los results van vacíos, hardDeadline check devuelve buckets vacíos', () => {
    const cpm = computeExtendedCpm(
      buildInput(
        [
          { id: 'A', duration: 1, isMilestone: false },
          {
            id: 'B',
            duration: 1,
            isMilestone: false,
            hardDeadline: new Date('2026-05-04T00:00:00Z'),
          },
        ],
        [
          { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
          { predecessorId: 'B', successorId: 'A', type: 'FS', lag: 0 },
        ],
      ),
    )
    expect(cpm.warnings.some((w) => w.code === 'CYCLE')).toBe(true)
    const r = checkHardDeadlines(cpm)
    // Como results queda vacío, no hay nada que clasificar.
    expect(r.violations).toHaveLength(0)
    expect(r.warnings).toHaveLength(0)
    expect(r.safe).toHaveLength(0)
  })

  it('orden estable: violations ordenadas por (slackDays asc, taskId asc)', () => {
    const cpm = computeExtendedCpm(
      buildInput([
        // Todas con misma EF=3, distintas hardDeadlines.
        {
          id: 'Z',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-05-04T00:00:00Z'), // slack -3
        },
        {
          id: 'A',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-05-05T00:00:00Z'), // slack -2
        },
        {
          id: 'B',
          duration: 3,
          isMilestone: false,
          hardDeadline: new Date('2026-05-04T00:00:00Z'), // slack -3 (empate con Z)
        },
      ]),
    )
    const r = checkHardDeadlines(cpm)
    expect(r.violations.map((v) => v.taskId)).toEqual(['B', 'Z', 'A'])
  })
})
