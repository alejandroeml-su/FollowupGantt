import { describe, it, expect } from 'vitest'
import {
  computeWorkload,
  listDays,
  taskDaysInRange,
  toIsoDay,
  utilizationRatio,
  startOfDayUTC,
  type WorkloadTaskInput,
} from '@/lib/resources/workload-calc'

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('resources/workload-calc · helpers', () => {
  it('toIsoDay normaliza a YYYY-MM-DD UTC', () => {
    expect(toIsoDay(utc('2026-05-12'))).toBe('2026-05-12')
    // Mediodía local que cruza zona también cae en el día UTC correcto.
    expect(toIsoDay(new Date('2026-05-12T06:30:00.000Z'))).toBe('2026-05-12')
  })

  it('startOfDayUTC truncates to UTC midnight', () => {
    const result = startOfDayUTC(new Date('2026-05-12T15:42:00.000Z'))
    expect(result.toISOString()).toBe('2026-05-12T00:00:00.000Z')
  })

  it('listDays inclusivo de extremos', () => {
    const days = listDays(utc('2026-05-01'), utc('2026-05-03'))
    expect(days).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('listDays devuelve [] si rangeStart > rangeEnd', () => {
    expect(listDays(utc('2026-05-05'), utc('2026-05-01'))).toEqual([])
  })

  it('taskDaysInRange clipa por rango', () => {
    const days = taskDaysInRange(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-10') },
      utc('2026-05-05'),
      utc('2026-05-08'),
    )
    expect(days).toEqual([
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
    ])
  })

  it('taskDaysInRange devuelve [] si la task no toca el rango', () => {
    const days = taskDaysInRange(
      { startDate: utc('2026-05-01'), endDate: utc('2026-05-03') },
      utc('2026-05-10'),
      utc('2026-05-15'),
    )
    expect(days).toEqual([])
  })

  it('utilizationRatio = horas/capacidad', () => {
    expect(utilizationRatio(4, 8)).toBe(0.5)
    expect(utilizationRatio(8, 8)).toBe(1)
    expect(utilizationRatio(12, 8)).toBeCloseTo(1.5)
  })

  it('utilizationRatio con capacidad 0 → ∞ si hay carga, 0 si no', () => {
    expect(utilizationRatio(4, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(utilizationRatio(0, 0)).toBe(0)
  })
})

describe('resources/workload-calc · computeWorkload', () => {
  function singleTask(over: Partial<WorkloadTaskInput> = {}): WorkloadTaskInput {
    return {
      id: 't1',
      title: 'Task 1',
      assigneeId: 'user-A',
      startDate: utc('2026-05-04'),
      endDate: utc('2026-05-08'),
      dailyEffortHours: 4,
      ...over,
    }
  }

  it('valida rangeStart <= rangeEnd', () => {
    expect(() =>
      computeWorkload({
        userIds: ['user-A'],
        tasks: [],
        rangeStart: utc('2026-05-10'),
        rangeEnd: utc('2026-05-01'),
      }),
    ).toThrowError(/INVALID_INPUT/)
  })

  it('valida defaultDailyEffortHours > 0', () => {
    expect(() =>
      computeWorkload({
        userIds: ['user-A'],
        tasks: [],
        rangeStart: utc('2026-05-01'),
        rangeEnd: utc('2026-05-02'),
        defaultDailyEffortHours: 0,
      }),
    ).toThrowError(/INVALID_INPUT/)
  })

  it('agrega 4h/día durante 5 días', () => {
    const result = computeWorkload({
      userIds: ['user-A'],
      tasks: [singleTask()],
      rangeStart: utc('2026-05-01'),
      rangeEnd: utc('2026-05-10'),
    })
    const userRow = result.byUser[0]
    expect(userRow?.userId).toBe('user-A')
    expect(userRow?.dailyLoad.get('2026-05-04')).toBe(4)
    expect(userRow?.dailyLoad.get('2026-05-08')).toBe(4)
    expect(userRow?.dailyLoad.get('2026-05-09')).toBe(0)
    expect(userRow?.peakDailyHours).toBe(4)
  })

  it('suma cargas cuando hay múltiples tasks en el mismo día', () => {
    const t1 = singleTask({ id: 't1', dailyEffortHours: 4 })
    const t2 = singleTask({ id: 't2', dailyEffortHours: 6 })
    const result = computeWorkload({
      userIds: ['user-A'],
      tasks: [t1, t2],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-04'),
    })
    expect(result.byUser[0]?.dailyLoad.get('2026-05-04')).toBe(10)
    expect(result.byUser[0]?.peakDailyHours).toBe(10)
  })

  it('detecta overload con capacidad por user', () => {
    const t1 = singleTask({ id: 't1', dailyEffortHours: 12 })
    const result = computeWorkload({
      userIds: ['user-A'],
      tasks: [t1],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-08'),
      capacityByUser: new Map([['user-A', 8]]),
    })
    expect(result.byUser[0]?.totalOverloadDays).toBe(5)
    expect(result.byUser[0]?.totalOverloadHours).toBe(20) // 5d × (12-8)h
  })

  it('si dailyEffortHours es null usa default', () => {
    const t1 = singleTask({ dailyEffortHours: null })
    const result = computeWorkload({
      userIds: ['user-A'],
      tasks: [t1],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-04'),
      defaultDailyEffortHours: 7,
    })
    expect(result.byUser[0]?.dailyLoad.get('2026-05-04')).toBe(7)
  })

  it('ignora tasks de otros usuarios', () => {
    const tA = singleTask({ assigneeId: 'user-A', dailyEffortHours: 5 })
    const tB = singleTask({ id: 't-other', assigneeId: 'user-B', dailyEffortHours: 3 })
    const result = computeWorkload({
      userIds: ['user-A', 'user-B'],
      tasks: [tA, tB],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-04'),
    })
    expect(result.byUser[0]?.dailyLoad.get('2026-05-04')).toBe(5)
    expect(result.byUser[1]?.dailyLoad.get('2026-05-04')).toBe(3)
  })

  it('respeta nonWorkingDays — no suma carga ni cuenta overload', () => {
    const t1 = singleTask({ dailyEffortHours: 12 })
    const result = computeWorkload({
      userIds: ['user-A'],
      tasks: [t1],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-08'),
      capacityByUser: new Map([['user-A', 8]]),
      nonWorkingDays: [utc('2026-05-06')],
    })
    expect(result.byUser[0]?.dailyLoad.get('2026-05-06')).toBe(0)
    expect(result.byUser[0]?.totalOverloadDays).toBe(4)
  })

  it('contributions registran taskId y hours', () => {
    const t1 = singleTask({ id: 't-x', title: 'X', dailyEffortHours: 5 })
    const result = computeWorkload({
      userIds: ['user-A'],
      tasks: [t1],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-04'),
    })
    const detail = result.byUser[0]?.dailyDetail[0]
    expect(detail?.contributions.length).toBe(1)
    expect(detail?.contributions[0]?.taskId).toBe('t-x')
    expect(detail?.contributions[0]?.taskTitle).toBe('X')
    expect(detail?.contributions[0]?.hours).toBe(5)
  })

  it('retorna un userIds vacío sin error', () => {
    const result = computeWorkload({
      userIds: [],
      tasks: [],
      rangeStart: utc('2026-05-04'),
      rangeEnd: utc('2026-05-08'),
    })
    expect(result.byUser).toEqual([])
    expect(result.days.length).toBe(5)
  })

  it('determinismo: mismo input ⇒ misma salida', () => {
    const input = {
      userIds: ['user-A'],
      tasks: [singleTask()],
      rangeStart: utc('2026-05-01'),
      rangeEnd: utc('2026-05-10'),
    } as const
    const r1 = computeWorkload(input)
    const r2 = computeWorkload(input)
    expect(JSON.stringify({ ...r1, byUser: r1.byUser.map(u => ({ ...u, dailyLoad: Array.from(u.dailyLoad) })) }))
      .toBe(JSON.stringify({ ...r2, byUser: r2.byUser.map(u => ({ ...u, dailyLoad: Array.from(u.dailyLoad) })) }))
  })
})
