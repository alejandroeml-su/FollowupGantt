/**
 * Wave P10 (HU-10.7 · BETA-2.2) — Cómputo de allocation cross-project.
 *
 * Calcula la carga semanal (en horas) de cada usuario distribuida por
 * proyecto, basada en:
 *  - Tasks activas asignadas con `dailyEffortHours` y rango (start/end)
 *  - WorkCalendar del proyecto + UserAvailability del usuario
 *
 * Devuelve snapshots semanales listos para persistir en
 * `ResourceAllocationSnapshot` (cron) o entregar a la UI on-demand.
 *
 * Módulo puro — recibe los datos ya cargados (tasks + availabilities + calendar).
 */

import {
  availableHoursForUser,
  type UserAvailabilityLike,
} from '@/lib/scheduling/user-availability'
import type { WorkCalendarLike } from '@/lib/scheduling/work-calendar'

export interface AllocationTaskInput {
  taskId: string
  projectId: string
  projectName: string
  startDate: Date
  endDate: Date
  dailyEffortHours: number
}

export interface UserAllocationInput {
  userId: string
  userName: string
  /** Calendario base que aplica al usuario (puede ser global o por proyecto). */
  calendar: WorkCalendarLike
  availabilities: ReadonlyArray<UserAvailabilityLike>
  tasks: ReadonlyArray<AllocationTaskInput>
  /** Horas de jornada estándar para cómputo de % allocation. Default 8. */
  standardHours?: number
}

export interface ProjectAllocationDetail {
  projectId: string
  projectName: string
  hours: number
  percent: number
}

export interface WeeklyAllocationSnapshot {
  userId: string
  userName: string
  /** Lunes UTC de la semana. */
  weekStart: Date
  /** Capacidad del usuario esa semana (horas, considerando availability). */
  capacityHours: number
  /** Suma planeada esa semana. */
  totalHours: number
  /** Detalle por proyecto. */
  allocations: ProjectAllocationDetail[]
  /** True si la suma > capacityHours. */
  overAllocated: boolean
}

const MS_PER_DAY = 86_400_000

function startOfDayUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

/**
 * Devuelve el lunes UTC de la semana de `d`.
 * (Lunes = 1; si `d` es lunes mismo lo retorna; si es domingo retrocede 6 días.)
 */
export function weekStartMonday(d: Date): Date {
  const utc = startOfDayUTC(d)
  const jsDow = utc.getUTCDay() // 0=Dom, 1=Lun, ..., 6=Sab
  const offset = jsDow === 0 ? 6 : jsDow - 1
  return new Date(utc.getTime() - offset * MS_PER_DAY)
}

function eachDayInRange(from: Date, to: Date): Date[] {
  const out: Date[] = []
  let cursor = startOfDayUTC(from)
  const end = startOfDayUTC(to)
  while (cursor.getTime() <= end.getTime()) {
    out.push(new Date(cursor))
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
  }
  return out
}

/**
 * Cómputo principal: dado un usuario y rango [from,to], devuelve un array
 * de snapshots semanales (lunes-domingo).
 *
 * Para cada día:
 *  1. Calcular available hours (calendar + availability).
 *  2. Para cada task activa en ese día, sumar dailyEffortHours.
 *  3. Acumular por proyecto.
 *
 * Después agrupa días en semanas y entrega snapshots.
 */
export function computeUserWeeklyAllocations(
  input: UserAllocationInput,
  from: Date,
  to: Date,
): WeeklyAllocationSnapshot[] {
  const standardHours = input.standardHours ?? 8
  const days = eachDayInRange(from, to)

  type DayBucket = {
    capacity: number
    byProject: Map<string, { name: string; hours: number }>
  }
  const dayBuckets = new Map<number, DayBucket>()

  for (const d of days) {
    const cap = availableHoursForUser(
      d,
      input.calendar,
      input.availabilities,
      standardHours,
    )
    const bucket: DayBucket = { capacity: cap, byProject: new Map() }
    if (cap > 0) {
      for (const t of input.tasks) {
        const start = startOfDayUTC(t.startDate)
        const end = startOfDayUTC(t.endDate)
        if (d.getTime() < start.getTime() || d.getTime() > end.getTime()) {
          continue
        }
        const cur = bucket.byProject.get(t.projectId) ?? {
          name: t.projectName,
          hours: 0,
        }
        cur.hours += t.dailyEffortHours
        bucket.byProject.set(t.projectId, cur)
      }
    }
    dayBuckets.set(d.getTime(), bucket)
  }

  // Agrupar por semana.
  const weekMap = new Map<
    number,
    {
      capacityHours: number
      byProject: Map<string, { name: string; hours: number }>
    }
  >()

  for (const d of days) {
    const wk = weekStartMonday(d).getTime()
    const bucket = dayBuckets.get(d.getTime())!
    const acc = weekMap.get(wk) ?? {
      capacityHours: 0,
      byProject: new Map(),
    }
    acc.capacityHours += bucket.capacity
    for (const [pid, val] of bucket.byProject.entries()) {
      const cur = acc.byProject.get(pid) ?? { name: val.name, hours: 0 }
      cur.hours += val.hours
      acc.byProject.set(pid, cur)
    }
    weekMap.set(wk, acc)
  }

  const snapshots: WeeklyAllocationSnapshot[] = []
  for (const [wkTime, acc] of weekMap.entries()) {
    const total = Array.from(acc.byProject.values()).reduce(
      (s, v) => s + v.hours,
      0,
    )
    const allocations: ProjectAllocationDetail[] = Array.from(
      acc.byProject.entries(),
    ).map(([pid, val]) => ({
      projectId: pid,
      projectName: val.name,
      hours: Number(val.hours.toFixed(2)),
      percent:
        acc.capacityHours > 0
          ? Number(((val.hours / acc.capacityHours) * 100).toFixed(1))
          : 0,
    }))

    snapshots.push({
      userId: input.userId,
      userName: input.userName,
      weekStart: new Date(wkTime),
      capacityHours: Number(acc.capacityHours.toFixed(2)),
      totalHours: Number(total.toFixed(2)),
      allocations: allocations.sort((a, b) => b.hours - a.hours),
      overAllocated:
        acc.capacityHours > 0 && total > acc.capacityHours,
    })
  }

  return snapshots.sort(
    (a, b) => a.weekStart.getTime() - b.weekStart.getTime(),
  )
}
