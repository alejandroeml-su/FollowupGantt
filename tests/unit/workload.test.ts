import { describe, it, expect } from 'vitest'
import {
  computeWorkloadHeatmap,
  startOfWeekMondayUTC,
  nextNWeeks,
  workdaysInRange,
  utilizationTier,
} from '@/lib/workload/compute'
import {
  DEFAULT_WORKDAYS_BITMASK,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'

const monFri: WorkCalendarLike = {
  workdays: DEFAULT_WORKDAYS_BITMASK,
  holidays: [],
}

describe('workload heatmap', () => {
  describe('startOfWeekMondayUTC', () => {
    it('lunes devuelve el mismo lunes', () => {
      // 2026-05-04 es lunes
      const r = startOfWeekMondayUTC(new Date('2026-05-04T15:30:00Z'))
      expect(r.toISOString()).toBe('2026-05-04T00:00:00.000Z')
    })

    it('domingo retrocede al lunes anterior', () => {
      // 2026-05-03 es domingo → 2026-04-27 lunes
      const r = startOfWeekMondayUTC(new Date('2026-05-03T00:00:00Z'))
      expect(r.toISOString().slice(0, 10)).toBe('2026-04-27')
    })
  })

  describe('nextNWeeks', () => {
    it('genera 12 lunes consecutivos', () => {
      const weeks = nextNWeeks(new Date('2026-05-04T00:00:00Z'), 12)
      expect(weeks).toHaveLength(12)
      expect(weeks[0].toISOString().slice(0, 10)).toBe('2026-05-04')
      expect(weeks[11].toISOString().slice(0, 10)).toBe('2026-07-20')
    })
  })

  describe('workdaysInRange', () => {
    it('semana lun-dom = 5 workdays en lun-vie', () => {
      const r = workdaysInRange(
        new Date('2026-05-04T00:00:00Z'),
        new Date('2026-05-11T00:00:00Z'),
        monFri,
      )
      expect(r).toBe(5)
    })
  })

  describe('utilizationTier', () => {
    it('mapea correctamente cada tier', () => {
      expect(utilizationTier(0.3)).toBe('green')
      expect(utilizationTier(0.5)).toBe('yellow')
      expect(utilizationTier(0.79)).toBe('yellow')
      expect(utilizationTier(0.8)).toBe('orange')
      expect(utilizationTier(1.0)).toBe('orange')
      expect(utilizationTier(1.2)).toBe('red')
    })
  })

  describe('computeWorkloadHeatmap', () => {
    it('genera matriz 1 user × 4 semanas con utilización correcta', () => {
      // Una task de lun 4 a vie 8 mayo (5 días) para u1.
      // Lun-vie 8h ⇒ 40h plan / 40h disp = 100% en sem 1.
      const heatmap = computeWorkloadHeatmap({
        users: [{ id: 'u1', name: 'Alice' }],
        tasks: [
          {
            id: 't1',
            title: 'Setup',
            assigneeId: 'u1',
            startDate: new Date('2026-05-04T00:00:00Z'),
            endDate: new Date('2026-05-08T00:00:00Z'),
          },
        ],
        calendar: monFri,
        workdayHours: 8,
        weeksCount: 4,
        referenceDate: new Date('2026-05-04T00:00:00Z'),
      })
      expect(heatmap.weeks).toHaveLength(4)
      const week1 = heatmap.cells.find(
        (c) =>
          c.userId === 'u1' &&
          c.weekStart.toISOString().slice(0, 10) === '2026-05-04',
      )!
      expect(week1.plannedHours).toBeCloseTo(40)
      expect(week1.availableHours).toBeCloseTo(40)
      expect(week1.utilization).toBeCloseTo(1.0)
      expect(week1.tasks).toHaveLength(1)

      // Semana 2 (sin tasks) debe estar en 0%
      const week2 = heatmap.cells.find(
        (c) =>
          c.userId === 'u1' &&
          c.weekStart.toISOString().slice(0, 10) === '2026-05-11',
      )!
      expect(week2.plannedHours).toBe(0)
      expect(week2.utilization).toBe(0)
    })

    it('prorratea task que abarca 2 semanas', () => {
      // Task de lun 4 a lun 11 mayo (6 días, lun a lun siguiente).
      // Workdays cubiertos: lun 4..vie 8 (sem 1, 5d), lun 11 (sem 2, 1d).
      // Semana 1: 5*8=40h. Semana 2: 1*8=8h.
      const heatmap = computeWorkloadHeatmap({
        users: [{ id: 'u1', name: 'Alice' }],
        tasks: [
          {
            id: 't1',
            title: 'Long task',
            assigneeId: 'u1',
            startDate: new Date('2026-05-04T00:00:00Z'),
            endDate: new Date('2026-05-11T00:00:00Z'),
          },
        ],
        calendar: monFri,
        workdayHours: 8,
        weeksCount: 4,
        referenceDate: new Date('2026-05-04T00:00:00Z'),
      })
      const w1 = heatmap.cells.find(
        (c) =>
          c.userId === 'u1' &&
          c.weekStart.toISOString().slice(0, 10) === '2026-05-04',
      )!
      const w2 = heatmap.cells.find(
        (c) =>
          c.userId === 'u1' &&
          c.weekStart.toISOString().slice(0, 10) === '2026-05-11',
      )!
      expect(w1.plannedHours).toBeCloseTo(40)
      expect(w2.plannedHours).toBeCloseTo(8)
    })

    it('detecta sobreasignación >100% con 2 tasks paralelas full-time', () => {
      const heatmap = computeWorkloadHeatmap({
        users: [{ id: 'u1', name: 'Alice' }],
        tasks: [
          {
            id: 't1',
            title: 'Task A',
            assigneeId: 'u1',
            startDate: new Date('2026-05-04T00:00:00Z'),
            endDate: new Date('2026-05-08T00:00:00Z'),
          },
          {
            id: 't2',
            title: 'Task B',
            assigneeId: 'u1',
            startDate: new Date('2026-05-04T00:00:00Z'),
            endDate: new Date('2026-05-08T00:00:00Z'),
          },
        ],
        calendar: monFri,
        workdayHours: 8,
        weeksCount: 1,
        referenceDate: new Date('2026-05-04T00:00:00Z'),
      })
      const w1 = heatmap.cells[0]
      expect(w1.plannedHours).toBeCloseTo(80) // 2 tasks × 40h
      expect(w1.utilization).toBeCloseTo(2.0)
      expect(utilizationTier(w1.utilization)).toBe('red')
    })

    it('ignora tasks de otros assignees', () => {
      const heatmap = computeWorkloadHeatmap({
        users: [
          { id: 'u1', name: 'Alice' },
          { id: 'u2', name: 'Bob' },
        ],
        tasks: [
          {
            id: 't1',
            title: 'Solo Bob',
            assigneeId: 'u2',
            startDate: new Date('2026-05-04T00:00:00Z'),
            endDate: new Date('2026-05-08T00:00:00Z'),
          },
        ],
        calendar: monFri,
        workdayHours: 8,
        weeksCount: 1,
        referenceDate: new Date('2026-05-04T00:00:00Z'),
      })
      const cellU1 = heatmap.cells.find((c) => c.userId === 'u1')!
      const cellU2 = heatmap.cells.find((c) => c.userId === 'u2')!
      expect(cellU1.plannedHours).toBe(0)
      expect(cellU2.plannedHours).toBeCloseTo(40)
    })
  })
})
