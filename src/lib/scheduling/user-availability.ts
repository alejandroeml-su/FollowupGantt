/**
 * Wave P10 (HU-10.2) — User availability sobre el calendario laboral.
 *
 * Extiende `work-calendar.ts` (Ola P1.5) con bloques de no-disponibilidad
 * por usuario (vacaciones, enfermedad, training, jornada reducida).
 * Módulo puro, sin Prisma, para que CPM y SprintCapacity lo consuman
 * con datos ya cargados.
 */

import { isWorkday, startOfDayUTC, type WorkCalendarLike } from './work-calendar'

export type AvailabilityReason =
  | 'VACATION'
  | 'SICK'
  | 'TRAINING'
  | 'REDUCED_HOURS'
  | 'OTHER'

export interface UserAvailabilityLike {
  startDate: Date | string
  endDate: Date | string
  reason: AvailabilityReason
  /**
   * 0..100. Si null/undefined → bloque completo (0 horas disponibles).
   * Si presente → fracción reducida sobre la jornada estándar.
   */
  reducedHoursPercent?: number | null
}

const MS_PER_DAY = 86_400_000

function dateInRange(d: Date, start: Date, end: Date): boolean {
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime()
}

/**
 * Si el día está dentro de un bloque de no-disponibilidad del usuario,
 * devuelve ese bloque; si hay varios solapados gana el más restrictivo
 * (menor `reducedHoursPercent`; un bloque completo gana sobre uno reducido).
 */
export function findBlockingAvailability(
  date: Date,
  blocks: ReadonlyArray<UserAvailabilityLike>,
): UserAvailabilityLike | null {
  const d = startOfDayUTC(date)
  let winner: UserAvailabilityLike | null = null
  for (const b of blocks) {
    const s = startOfDayUTC(
      b.startDate instanceof Date ? b.startDate : new Date(b.startDate),
    )
    const e = startOfDayUTC(
      b.endDate instanceof Date ? b.endDate : new Date(b.endDate),
    )
    if (!dateInRange(d, s, e)) continue
    if (winner === null) {
      winner = b
      continue
    }
    const winnerPct = winner.reducedHoursPercent ?? 0
    const candidatePct = b.reducedHoursPercent ?? 0
    if (candidatePct < winnerPct) winner = b
  }
  return winner
}

/**
 * Horas disponibles para un usuario en una fecha dada.
 *
 * Combinación:
 *  1. Si el día NO es laborable según el calendario → 0
 *  2. Si hay un bloque de no-disponibilidad sin `reducedHoursPercent` → 0
 *  3. Si hay un bloque con `reducedHoursPercent` → `standardHours * pct/100`
 *  4. En otro caso → `standardHours`
 *
 * `standardHours` por convención = `WorkCalendar.workdayHours` (default 8).
 */
export function availableHoursForUser(
  date: Date,
  calendar: WorkCalendarLike,
  blocks: ReadonlyArray<UserAvailabilityLike>,
  standardHours = 8,
): number {
  if (!isWorkday(date, calendar)) return 0
  const block = findBlockingAvailability(date, blocks)
  if (!block) return standardHours
  if (block.reducedHoursPercent == null) return 0
  const pct = Math.max(0, Math.min(100, block.reducedHoursPercent))
  return standardHours * (pct / 100)
}

/**
 * Suma horas disponibles entre `from` (incluido) y `to` (incluido).
 * Útil para Sprint Capacity con calendario y disponibilidad real.
 *
 * Si `from > to` devuelve 0.
 */
export function totalAvailableHoursInRange(
  from: Date,
  to: Date,
  calendar: WorkCalendarLike,
  blocks: ReadonlyArray<UserAvailabilityLike>,
  standardHours = 8,
): number {
  const a = startOfDayUTC(from)
  const b = startOfDayUTC(to)
  if (a.getTime() > b.getTime()) return 0
  let total = 0
  let cursor = a
  // Cota dura para evitar bucles patológicos.
  const maxIter =
    Math.abs((b.getTime() - a.getTime()) / MS_PER_DAY) + 1
  for (let i = 0; i < maxIter; i++) {
    total += availableHoursForUser(cursor, calendar, blocks, standardHours)
    if (cursor.getTime() >= b.getTime()) break
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
  }
  return total
}
