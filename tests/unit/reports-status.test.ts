import { describe, it, expect } from 'vitest'
import {
  buildStatusReport,
  computeDelayedTasks,
  computeStatusSummary,
  diffDaysUTC,
  filterCriticalPath,
  isoWeekOfYear,
  weekRange,
  type StatusTaskInput,
} from '@/lib/reports/status-report'

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

const baseTask = (over: Partial<StatusTaskInput>): StatusTaskInput => ({
  id: 'x',
  title: 'Tarea',
  status: 'TODO',
  isMilestone: false,
  startDate: null,
  endDate: null,
  progress: 0,
  assigneeName: null,
  ...over,
})

describe('reports/status-report · isoWeekOfYear', () => {
  it('aplica algoritmo ISO 8601 a una fecha de mediados de mayo', () => {
    // 2026-05-04 lunes → 2026-W19
    expect(isoWeekOfYear(utc('2026-05-04'))).toBe('2026-W19')
  })

  it('soporta el cruce de año cuando enero arranca en jueves', () => {
    // 2026-01-01 cae en jueves → semana 1 del 2026
    expect(isoWeekOfYear(utc('2026-01-01'))).toBe('2026-W01')
    // 2025-12-30 (martes) cae en la última semana de 2025
    expect(isoWeekOfYear(utc('2025-12-30'))).toBe('2026-W01')
  })
})

describe('reports/status-report · weekRange', () => {
  it('devuelve lunes-domingo para una fecha de la semana', () => {
    // 2026-05-06 es miércoles → lunes 2026-05-04, domingo 2026-05-10
    const { start, end } = weekRange(utc('2026-05-06'))
    expect(start.toISOString().slice(0, 10)).toBe('2026-05-04')
    expect(end.toISOString().slice(0, 10)).toBe('2026-05-10')
  })

  it('idempotente cuando la fecha es lunes', () => {
    const { start } = weekRange(utc('2026-05-04'))
    expect(start.toISOString().slice(0, 10)).toBe('2026-05-04')
  })
})

describe('reports/status-report · diffDaysUTC', () => {
  it('suma positiva cuando b > a', () => {
    expect(diffDaysUTC(utc('2026-05-01'), utc('2026-05-04'))).toBe(3)
  })
  it('negativa cuando b < a', () => {
    expect(diffDaysUTC(utc('2026-05-04'), utc('2026-05-01'))).toBe(-3)
  })
})

describe('reports/status-report · computeStatusSummary', () => {
  it('progreso 0% sin tareas', () => {
    const s = computeStatusSummary([])
    expect(s.totalTasks).toBe(0)
    expect(s.progressPercent).toBe(0)
    expect(s.completedTasks).toBe(0)
    expect(s.upcomingMilestones).toEqual([])
  })

  it('promedia progreso de tareas y cuenta DONE', () => {
    const s = computeStatusSummary(
      [
        baseTask({ id: 'a', progress: 100, status: 'DONE' }),
        baseTask({ id: 'b', progress: 50 }),
        baseTask({ id: 'c', progress: 0 }),
      ],
      utc('2026-05-01'),
    )
    expect(s.progressPercent).toBe(50)
    expect(s.completedTasks).toBe(1)
    expect(s.totalTasks).toBe(3)
  })

  it('hitos próximos sólo dentro de los próximos 7 días, no completados', () => {
    const now = utc('2026-05-01')
    const s = computeStatusSummary(
      [
        baseTask({
          id: 'h-soon',
          isMilestone: true,
          status: 'TODO',
          endDate: utc('2026-05-05'),
        }),
        baseTask({
          id: 'h-later',
          isMilestone: true,
          status: 'TODO',
          endDate: utc('2026-05-30'),
        }),
        baseTask({
          id: 'h-done',
          isMilestone: true,
          status: 'DONE',
          endDate: utc('2026-05-03'),
        }),
        baseTask({
          id: 'h-past',
          isMilestone: true,
          status: 'TODO',
          endDate: utc('2026-04-25'),
        }),
      ],
      now,
    )
    expect(s.upcomingMilestones.length).toBe(1)
    expect(s.upcomingMilestones[0]?.id).toBe('h-soon')
    expect(s.upcomingMilestones[0]?.daysUntil).toBe(4)
  })
})

describe('reports/status-report · computeDelayedTasks', () => {
  it('sólo tareas con endDate < now y status != DONE', () => {
    const now = utc('2026-05-10')
    const delayed = computeDelayedTasks(
      [
        baseTask({
          id: 'late',
          status: 'IN_PROGRESS',
          endDate: utc('2026-05-05'),
          progress: 60,
          assigneeName: 'Edwin',
        }),
        baseTask({
          id: 'done-late',
          status: 'DONE',
          endDate: utc('2026-05-05'),
        }),
        baseTask({
          id: 'future',
          status: 'TODO',
          endDate: utc('2026-05-15'),
        }),
        baseTask({ id: 'no-date', status: 'TODO', endDate: null }),
      ],
      now,
    )
    expect(delayed.length).toBe(1)
    expect(delayed[0]?.id).toBe('late')
    expect(delayed[0]?.daysOverdue).toBe(5)
    expect(delayed[0]?.owner).toBe('Edwin')
  })

  it('ordena por daysOverdue descendente', () => {
    const now = utc('2026-05-10')
    const delayed = computeDelayedTasks(
      [
        baseTask({ id: 'a', status: 'TODO', endDate: utc('2026-05-08') }),
        baseTask({ id: 'b', status: 'TODO', endDate: utc('2026-05-01') }),
        baseTask({ id: 'c', status: 'TODO', endDate: utc('2026-05-05') }),
      ],
      now,
    )
    expect(delayed.map((d) => d.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('reports/status-report · filterCriticalPath', () => {
  it('filtra tareas por critical path y ordena por startDate', () => {
    const tasks = [
      baseTask({ id: 'a', startDate: utc('2026-05-05'), title: 'A' }),
      baseTask({ id: 'b', startDate: utc('2026-05-01'), title: 'B' }),
      baseTask({ id: 'c', startDate: utc('2026-05-10'), title: 'C' }),
      baseTask({ id: 'd', startDate: utc('2026-05-02'), title: 'D' }),
    ]
    const cp = filterCriticalPath(tasks, ['a', 'c', 'b'])
    expect(cp.map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })

  it('tasks sin startDate quedan al final', () => {
    const tasks = [
      baseTask({ id: 'a', startDate: utc('2026-05-05') }),
      baseTask({ id: 'b', startDate: null }),
    ]
    const cp = filterCriticalPath(tasks, ['a', 'b'])
    expect(cp[0]?.id).toBe('a')
    expect(cp[1]?.id).toBe('b')
  })
})

describe('reports/status-report · buildStatusReport', () => {
  it('devuelve un payload con todas las secciones', () => {
    const now = utc('2026-05-06')
    const report = buildStatusReport({
      projectId: 'p1',
      projectName: 'Proyecto Demo',
      tasks: [
        baseTask({
          id: 't1',
          status: 'IN_PROGRESS',
          progress: 60,
          startDate: utc('2026-05-01'),
          endDate: utc('2026-05-04'),
        }),
        baseTask({
          id: 'm1',
          isMilestone: true,
          status: 'TODO',
          endDate: utc('2026-05-08'),
        }),
        baseTask({
          id: 'd',
          status: 'DONE',
          progress: 100,
        }),
      ],
      criticalPathIds: ['t1'],
      now,
    })
    expect(report.projectId).toBe('p1')
    expect(report.weekOfYear).toBe('2026-W19')
    expect(report.summary.totalTasks).toBe(3)
    expect(report.summary.completedTasks).toBe(1)
    expect(report.summary.upcomingMilestones.length).toBe(1)
    expect(report.criticalPath.length).toBe(1)
    expect(report.delayedTasks.length).toBe(1) // t1 endDate 2026-05-04 < now
    expect(report.topRisks).toEqual([])
  })
})
