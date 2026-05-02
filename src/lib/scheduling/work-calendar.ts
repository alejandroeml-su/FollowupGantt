/**
 * Helpers de calendario laboral (Ola P1.5).
 *
 * Módulo puro (sin Prisma): opera sobre un `WorkCalendar` ya cargado para
 * decidir si una fecha es laborable, calcular siguientes días hábiles,
 * sumar workdays y contar workdays entre dos fechas.
 *
 * Convenciones:
 *  - Las fechas se normalizan a UTC midnight para comparaciones
 *    determinísticas (evita drift por zona horaria).
 *  - `workdays` es un bitmask 7 bits: bit 0 = lunes, bit 6 = domingo.
 *    Default lun-vie ⇒ 0b0011111 = 31.
 *  - Festivos `recurring=true` se comparan por mes/día (ignoran año).
 */

export interface WorkCalendarLike {
  workdays: number
  holidays: ReadonlyArray<{
    date: Date | string
    recurring?: boolean | null
  }>
}

/** Default: lunes a viernes laborables, 8 horas. */
export const DEFAULT_WORKDAYS_BITMASK = 0b0011111 // 31

const MS_PER_DAY = 86_400_000

/** Devuelve copia de `d` con horas/min/seg/ms a 0 en UTC. */
export function startOfDayUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

/**
 * Convierte el day-of-week JavaScript (0=domingo … 6=sábado) al bit del
 * bitmask (0=lunes … 6=domingo).
 */
function bitForDay(jsDow: number): number {
  // 0=Sun → bit 6, 1=Mon → bit 0, 2=Tue → bit 1, …, 6=Sat → bit 5
  return jsDow === 0 ? 6 : jsDow - 1
}

function isWorkdayBit(workdaysMask: number, jsDow: number): boolean {
  return (workdaysMask & (1 << bitForDay(jsDow))) !== 0
}

function sameMonthDay(a: Date, b: Date): boolean {
  return a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}

function sameDayUTC(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

/**
 * `true` si `date` es día laborable según el `calendar`:
 *  1) el bit del día de la semana está activo, Y
 *  2) la fecha NO coincide con un holiday (exacto si `recurring=false`,
 *     mismo mes/día si `recurring=true`).
 */
export function isWorkday(date: Date, calendar: WorkCalendarLike): boolean {
  const d = startOfDayUTC(date)
  if (!isWorkdayBit(calendar.workdays, d.getUTCDay())) return false
  for (const h of calendar.holidays) {
    const hDate = h.date instanceof Date ? h.date : new Date(h.date)
    const hUtc = startOfDayUTC(hDate)
    if (h.recurring) {
      if (sameMonthDay(d, hUtc)) return false
    } else {
      if (sameDayUTC(d, hUtc)) return false
    }
  }
  return true
}

/**
 * Devuelve el siguiente día laborable estrictamente posterior a `date`.
 * Si `date` es ya laborable, NO la devuelve (avanza al menos 1 día).
 */
export function nextWorkday(date: Date, calendar: WorkCalendarLike): Date {
  let cursor = startOfDayUTC(date)
  // Cota de seguridad: 366 iteraciones es suficiente incluso si todo el año
  // es no-laborable (caso degenerado) — evita bucles infinitos.
  for (let i = 0; i < 366; i++) {
    cursor = new Date(cursor.getTime() + MS_PER_DAY)
    if (isWorkday(cursor, calendar)) return cursor
  }
  return cursor
}

/**
 * Suma `days` días LABORABLES a `date`. Si `days = 0` devuelve la misma
 * fecha (normalizada). Si `date` no es laborable, igual cuenta solo los
 * laborables siguientes.
 *
 * Convención: `addWorkdays(d, 1)` = primer workday > d. Si `d` es lunes y
 * 1=workday, el resultado es el martes laborable más cercano (no el lunes).
 * Coincide con la semántica usada por MS Project para "días de trabajo".
 */
export function addWorkdays(
  date: Date,
  days: number,
  calendar: WorkCalendarLike,
): Date {
  if (days === 0) return startOfDayUTC(date)
  const direction = days > 0 ? 1 : -1
  let remaining = Math.abs(days)
  let cursor = startOfDayUTC(date)
  // Cota: |days| * 7 + 366 cubre el peor caso (calendario raro + holidays).
  const maxIter = Math.abs(days) * 10 + 366
  for (let i = 0; i < maxIter && remaining > 0; i++) {
    cursor = new Date(cursor.getTime() + direction * MS_PER_DAY)
    if (isWorkday(cursor, calendar)) remaining--
  }
  return cursor
}

/**
 * Cuenta cuántos días LABORABLES hay entre `from` (incluido) y `to`
 * (excluido). Si `from > to`, devuelve negativo. Si son la misma fecha,
 * devuelve 0.
 *
 * Útil para convertir "días corridos" a "días de trabajo" al integrar
 * fechas absolutas con CPM (que opera en unidades de duration).
 */
export function workdaysBetween(
  from: Date,
  to: Date,
  calendar: WorkCalendarLike,
): number {
  const a = startOfDayUTC(from)
  const b = startOfDayUTC(to)
  if (a.getTime() === b.getTime()) return 0
  const direction = a.getTime() < b.getTime() ? 1 : -1
  let count = 0
  let cursor = new Date(a)
  // Loop hasta alcanzar b. La cota es |diffDays|+1 (cada iteración avanza 1d).
  const maxIter =
    Math.abs((b.getTime() - a.getTime()) / MS_PER_DAY) + 1
  for (let i = 0; i < maxIter; i++) {
    if (cursor.getTime() === b.getTime()) break
    cursor = new Date(cursor.getTime() + direction * MS_PER_DAY)
    // Para `direction = +1`, contamos el día al que llegamos (cursor).
    // Para `direction = -1`, contamos el día que dejamos (era el anterior cursor).
    const evalDay = direction > 0 ? cursor : new Date(cursor.getTime() + MS_PER_DAY)
    if (isWorkday(evalDay, calendar)) count += direction
  }
  return count
}

/**
 * Convierte una duración expresada en "días de trabajo" a fecha de fin
 * dado un inicio. Equivalente a `addWorkdays(start, duration)` pero
 * incluye el día de inicio si éste es laborable (semántica MS Project:
 * duration=1 ⇒ start = end mismo día laborable).
 *
 * Si `duration = 0` (hito) ⇒ devuelve start.
 */
export function endDateFromDuration(
  start: Date,
  duration: number,
  calendar: WorkCalendarLike,
): Date {
  if (duration <= 0) return startOfDayUTC(start)
  // Caminamos `duration - 1` días laborables, contando el día de inicio si lo es.
  let cursor = startOfDayUTC(start)
  const startIsWorkday = isWorkday(cursor, calendar)
  // Si el día de inicio NO era laborable, primero saltar al primer workday.
  if (!startIsWorkday) cursor = nextWorkday(cursor, calendar)
  if (duration === 1) return cursor
  return addWorkdays(cursor, duration - 1, calendar)
}
