import { describe, it, expect } from 'vitest'
import {
  computeUserWeeklyAllocations,
  weekStartMonday,
  type AllocationTaskInput,
  type UserAllocationInput,
} from '@/lib/allocation/compute'
import type { WorkCalendarLike } from '@/lib/scheduling/work-calendar'

const MON_TO_FRI: WorkCalendarLike = { workdays: 0b0011111, holidays: [] }
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('allocation · weekStartMonday', () => {
  it('lunes de la misma semana se devuelve igual', () => {
    // 2026-06-01 es lunes
    expect(weekStartMonday(utc('2026-06-01')).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    )
  })

  it('martes regresa al lunes anterior', () => {
    expect(weekStartMonday(utc('2026-06-02')).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    )
  })

  it('domingo regresa al lunes anterior (6 días atrás)', () => {
    // 2026-06-07 es domingo → lunes 2026-06-01
    expect(weekStartMonday(utc('2026-06-07')).toISOString()).toBe(
      '2026-06-01T00:00:00.000Z',
    )
  })
})

describe('allocation · computeUserWeeklyAllocations', () => {
  const baseUser = (
    tasks: AllocationTaskInput[],
    availabilities: UserAllocationInput['availabilities'] = [],
  ): UserAllocationInput => ({
    userId: 'u1',
    userName: 'Edwin',
    calendar: MON_TO_FRI,
    availabilities,
    tasks,
  })

  it('un solo proyecto · una semana laboral completa', () => {
    const tasks: AllocationTaskInput[] = [
      {
        taskId: 't1',
        projectId: 'p1',
        projectName: 'Proyecto Alpha',
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        dailyEffortHours: 4,
      },
    ]
    const result = computeUserWeeklyAllocations(
      baseUser(tasks),
      utc('2026-06-01'),
      utc('2026-06-05'),
    )
    expect(result).toHaveLength(1)
    expect(result[0].capacityHours).toBe(40) // 5 días × 8h
    expect(result[0].totalHours).toBe(20) // 5 × 4h
    expect(result[0].overAllocated).toBe(false)
    expect(result[0].allocations).toHaveLength(1)
    expect(result[0].allocations[0].percent).toBe(50)
  })

  it('over-allocation flag cuando total > capacity', () => {
    const tasks: AllocationTaskInput[] = [
      {
        taskId: 't1',
        projectId: 'p1',
        projectName: 'Alpha',
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        dailyEffortHours: 6,
      },
      {
        taskId: 't2',
        projectId: 'p2',
        projectName: 'Beta',
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        dailyEffortHours: 5,
      },
    ]
    const result = computeUserWeeklyAllocations(
      baseUser(tasks),
      utc('2026-06-01'),
      utc('2026-06-05'),
    )
    // Total: 5×11 = 55h vs capacity 40h
    expect(result[0].totalHours).toBe(55)
    expect(result[0].capacityHours).toBe(40)
    expect(result[0].overAllocated).toBe(true)
  })

  it('vacación reduce capacity y descuenta horas en días no disponibles', () => {
    const tasks: AllocationTaskInput[] = [
      {
        taskId: 't1',
        projectId: 'p1',
        projectName: 'Alpha',
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        dailyEffortHours: 8,
      },
    ]
    const result = computeUserWeeklyAllocations(
      baseUser(tasks, [
        {
          startDate: utc('2026-06-03'),
          endDate: utc('2026-06-04'),
          reason: 'VACATION',
        },
      ]),
      utc('2026-06-01'),
      utc('2026-06-05'),
    )
    // Días disponibles: lun, mar, vie = 3 × 8 = 24h capacity
    expect(result[0].capacityHours).toBe(24)
    // Las horas asignadas en vacación NO cuentan (el motor solo agrega
    // horas en días donde capacity > 0). Total = 3 × 8 = 24h.
    expect(result[0].totalHours).toBe(24)
    // 24 = 24 → no over-allocated, está exactamente al límite.
    expect(result[0].overAllocated).toBe(false)
  })

  it('reduced_hours 50% baja capacity sin bloquear el día', () => {
    const tasks: AllocationTaskInput[] = [
      {
        taskId: 't1',
        projectId: 'p1',
        projectName: 'Alpha',
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        dailyEffortHours: 4,
      },
    ]
    const result = computeUserWeeklyAllocations(
      baseUser(tasks, [
        {
          startDate: utc('2026-06-01'),
          endDate: utc('2026-06-05'),
          reason: 'REDUCED_HOURS',
          reducedHoursPercent: 50,
        },
      ]),
      utc('2026-06-01'),
      utc('2026-06-05'),
    )
    // Capacity: 5 días × 4h (50% de 8h) = 20h
    expect(result[0].capacityHours).toBe(20)
    // Total: 5 días × 4h asignadas = 20h
    expect(result[0].totalHours).toBe(20)
    expect(result[0].overAllocated).toBe(false)
  })

  it('multi-semana: 2 semanas laborales devuelven 2 snapshots', () => {
    const tasks: AllocationTaskInput[] = [
      {
        taskId: 't1',
        projectId: 'p1',
        projectName: 'Alpha',
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-12'),
        dailyEffortHours: 4,
      },
    ]
    const result = computeUserWeeklyAllocations(
      baseUser(tasks),
      utc('2026-06-01'),
      utc('2026-06-12'),
    )
    expect(result).toHaveLength(2)
  })

  it('detalle por proyecto se ordena por horas descendente', () => {
    const tasks: AllocationTaskInput[] = [
      {
        taskId: 't1',
        projectId: 'p1',
        projectName: 'Pequeño',
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        dailyEffortHours: 1,
      },
      {
        taskId: 't2',
        projectId: 'p2',
        projectName: 'Grande',
        startDate: utc('2026-06-01'),
        endDate: utc('2026-06-05'),
        dailyEffortHours: 6,
      },
    ]
    const result = computeUserWeeklyAllocations(
      baseUser(tasks),
      utc('2026-06-01'),
      utc('2026-06-05'),
    )
    expect(result[0].allocations[0].projectName).toBe('Grande')
    expect(result[0].allocations[1].projectName).toBe('Pequeño')
  })
})
