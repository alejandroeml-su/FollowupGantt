/**
 * Compute workload heatmap (Ola P1.5).
 *
 * Módulo PURO sin Prisma: dado un set de tasks asignadas + el calendar
 * laboral default, calcula la matriz `usuario × semana` de horas
 * planificadas y horas disponibles, con porcentaje de utilización.
 *
 * - Horas planificadas: cada task aporta `(workdays_en_semana × workdayHours)`,
 *   prorrateado: si la task abarca varias semanas, la fracción que cae
 *   en cada semana se cuenta en esa columna.
 * - Horas disponibles por semana = workdays_en_semana × workdayHours.
 * - Utilización = planificadas / disponibles. Sin disponibilidad ⇒ 0.
 */

import {
  isWorkday,
  startOfDayUTC,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'

export const DEFAULT_HEATMAP_WEEKS = 12

const MS_PER_DAY = 86_400_000

export interface WorkloadTask {
  id: string
  title: string
  projectName?: string
  assigneeId: string
  startDate: Date
  endDate: Date
}

export interface WorkloadUser {
  id: string
  name: string
}

export interface WorkloadCellTask {
  id: string
  title: string
  projectName?: string
  hours: number // horas que la task contribuye a esta celda
}

export interface WorkloadCell {
  weekStart: Date // lunes UTC de la semana
  userId: string
  plannedHours: number
  availableHours: number
  utilization: number // 0..2 (puede pasar de 1.0)
  tasks: WorkloadCellTask[]
}

export interface WorkloadHeatmap {
  weeks: Date[] // 12 lunes UTC
  users: WorkloadUser[]
  cells: WorkloadCell[]
}

/**
 * Devuelve el lunes (UTC) de la semana de `d`. JS dow: 0=dom..6=sab.
 * Convención ISO: lunes es inicio de semana.
 */
export function startOfWeekMondayUTC(d: Date): Date {
  const day = startOfDayUTC(d)
  const dow = day.getUTCDay() // 0..6
  const offset = dow === 0 ? -6 : 1 - dow // 0=dom→-6, 1=lun→0, 2=mar→-1...
  return new Date(day.getTime() + offset * MS_PER_DAY)
}

/** Devuelve los próximos `count` lunes (UTC) empezando por la semana de `from`. */
export function nextNWeeks(from: Date, count: number): Date[] {
  const monday = startOfWeekMondayUTC(from)
  const weeks: Date[] = []
  for (let i = 0; i < count; i++) {
    weeks.push(new Date(monday.getTime() + i * 7 * MS_PER_DAY))
  }
  return weeks
}

function endOfWeek(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 7 * MS_PER_DAY)
}

/** Cuenta los workdays (según calendar) en `[from, to)`. */
export function workdaysInRange(
  from: Date,
  to: Date,
  calendar: WorkCalendarLike,
): number {
  const a = startOfDayUTC(from).getTime()
  const b = startOfDayUTC(to).getTime()
  if (a >= b) return 0
  let count = 0
  for (let t = a; t < b; t += MS_PER_DAY) {
    if (isWorkday(new Date(t), calendar)) count++
  }
  return count
}

/**
 * Determina cuántos workdays de una task `[taskStart, taskEnd)` caen
 * dentro de la ventana semanal `[weekStart, weekEnd)`.
 *
 * Convención: `endDate` se considera inclusivo del último día (típico
 * en Gantt PMI), por eso le sumamos 1 día al cerrar el rango.
 */
function workdaysOverlap(
  taskStart: Date,
  taskEndInclusive: Date,
  weekStart: Date,
  weekEnd: Date,
  calendar: WorkCalendarLike,
): number {
  const taskEndExclusive = new Date(
    startOfDayUTC(taskEndInclusive).getTime() + MS_PER_DAY,
  )
  const start = new Date(
    Math.max(startOfDayUTC(taskStart).getTime(), weekStart.getTime()),
  )
  const end = new Date(Math.min(taskEndExclusive.getTime(), weekEnd.getTime()))
  if (start.getTime() >= end.getTime()) return 0
  return workdaysInRange(start, end, calendar)
}

export interface ComputeHeatmapInput {
  tasks: WorkloadTask[]
  users: WorkloadUser[]
  calendar: WorkCalendarLike
  workdayHours: number
  weeks?: Date[] // si no se pasa, se calculan 12 semanas desde hoy
  weeksCount?: number
  referenceDate?: Date
}

export function computeWorkloadHeatmap(
  input: ComputeHeatmapInput,
): WorkloadHeatmap {
  const refDate = input.referenceDate ?? new Date()
  const weeks =
    input.weeks ??
    nextNWeeks(refDate, input.weeksCount ?? DEFAULT_HEATMAP_WEEKS)

  const cells: WorkloadCell[] = []
  for (const user of input.users) {
    for (const weekStart of weeks) {
      const weekEnd = endOfWeek(weekStart)
      const availDays = workdaysInRange(weekStart, weekEnd, input.calendar)
      const availableHours = availDays * input.workdayHours

      const tasksThisCell: WorkloadCellTask[] = []
      let plannedHours = 0
      for (const task of input.tasks) {
        if (task.assigneeId !== user.id) continue
        const overlap = workdaysOverlap(
          task.startDate,
          task.endDate,
          weekStart,
          weekEnd,
          input.calendar,
        )
        if (overlap <= 0) continue
        const hours = overlap * input.workdayHours
        plannedHours += hours
        tasksThisCell.push({
          id: task.id,
          title: task.title,
          projectName: task.projectName,
          hours,
        })
      }

      cells.push({
        weekStart,
        userId: user.id,
        plannedHours,
        availableHours,
        utilization:
          availableHours > 0 ? plannedHours / availableHours : 0,
        tasks: tasksThisCell,
      })
    }
  }

  return { weeks, users: input.users, cells }
}

/**
 * Mapea utilización (0..∞) a uno de los 4 tiers visuales.
 */
export function utilizationTier(
  u: number,
): 'green' | 'yellow' | 'orange' | 'red' {
  if (u > 1.0) return 'red'
  if (u >= 0.8) return 'orange'
  if (u >= 0.5) return 'yellow'
  return 'green'
}
