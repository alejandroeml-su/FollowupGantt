/**
 * Cálculo de capacidad efectiva (h/día) por usuario · día (Ola P8 · P8-1).
 *
 * Módulo PURO sin Prisma. Es el reverso de `workload-calc.ts`: en lugar de
 * agregar tasks asignadas, calcula cuántas horas TIENE el usuario para
 * trabajar cada día tomando en cuenta:
 *
 *   1. Calendario laboral del proyecto (workdays bitmask + holidays).
 *   2. Workday hours (default 8h, configurable).
 *   3. Sprint overrides (`Sprint.capacityPerUser`):
 *        { [userId]: { dailyHours?, off? } }
 *      - `dailyHours` reemplaza el default 8 para ese user en cada día
 *        del rango (mientras el sprint esté vigente).
 *      - `off` lista días ISO YYYY-MM-DD donde el user tiene 0h disponibles
 *        (vacaciones, on-call externo, mediación con cliente).
 *   4. Reuniones (placeholder vacío en MVP — se restará en P8.5 cuando
 *      `MeetingSlot` exista. La firma deja el hook listo).
 *
 * El return mantiene la misma forma del workload (Map<DateISO, hours>)
 * para que la UI pueda hacer "diff" trivial.
 */
import {
  isWorkday,
  startOfDayUTC,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'
import { listDays, MS_PER_DAY, toIsoDay } from './workload-calc'

export interface CapacityOverridePerUser {
  /** Sobrescribe horas/día del usuario en el rango (def: workdayHours del calendar). */
  dailyHours?: number
  /** Días ISO YYYY-MM-DD sin disponibilidad (vacaciones, etc.). */
  off?: ReadonlyArray<string>
}

export interface CapacityOverrideMap {
  [userId: string]: CapacityOverridePerUser | undefined
}

export interface ComputeCapacityInput {
  userIds: ReadonlyArray<string>
  rangeStart: Date
  /** Inclusivo. */
  rangeEnd: Date
  calendar?: WorkCalendarLike
  /** Default workday hours. Si el calendar trae uno distinto, lo respeta el caller. */
  workdayHours?: number
  /** Overrides por sprint (Sprint.capacityPerUser parsed). */
  overrides?: CapacityOverrideMap
}

export interface CapacityByUser {
  userId: string
  /** Map<DateISO, hours>. Iteración determinista en orden ascendente. */
  dailyCapacity: Map<string, number>
  /** Suma horas disponibles en todo el rango. */
  totalCapacityHours: number
  /** Cantidad de días distintos con capacidad > 0. */
  workingDaysCount: number
}

export interface CapacityResult {
  rangeStart: Date
  rangeEnd: Date
  days: string[]
  byUser: CapacityByUser[]
}

/**
 * Verifica si una fecha es laborable según el calendario provisto.
 * Si no hay calendar ⇒ asume lun-vie laborables (sin festivos).
 */
function isCalendarWorkday(d: Date, cal: WorkCalendarLike | undefined): boolean {
  if (!cal) {
    const dow = startOfDayUTC(d).getUTCDay()
    return dow >= 1 && dow <= 5
  }
  return isWorkday(d, cal)
}

/**
 * Calcula la capacidad diaria por usuario en el rango.
 *
 * Para cada día y user:
 *   - Si el día NO es laborable según el calendar ⇒ 0.
 *   - Si el día está en `overrides[userId].off` ⇒ 0.
 *   - Else, capacidad = `overrides[userId].dailyHours ?? workdayHours ?? 8`.
 *
 * NOTA: el placeholder de "reuniones" se aplica como simple substracción
 * cuando `meetingsByUserDay` exista (P8.5). Por ahora, se omite.
 */
export function computeCapacity(
  input: ComputeCapacityInput,
): CapacityResult {
  if (!input.rangeStart || !input.rangeEnd) {
    throw new Error('[INVALID_INPUT] rangeStart y rangeEnd son obligatorios')
  }
  const rangeStart = startOfDayUTC(input.rangeStart)
  const rangeEnd = startOfDayUTC(input.rangeEnd)
  if (rangeStart.getTime() > rangeEnd.getTime()) {
    throw new Error('[INVALID_INPUT] rangeStart debe ser <= rangeEnd')
  }
  const defaultHours = input.workdayHours ?? 8
  if (defaultHours < 0) {
    throw new Error('[INVALID_INPUT] workdayHours no puede ser negativo')
  }

  const days = listDays(rangeStart, rangeEnd)
  const dayDates = days.map(
    (_iso, idx) => new Date(rangeStart.getTime() + idx * MS_PER_DAY),
  )

  const byUser: CapacityByUser[] = input.userIds.map((userId) => {
    const userOverride = input.overrides?.[userId]
    const offSet = new Set(userOverride?.off ?? [])
    const baseHours = userOverride?.dailyHours ?? defaultHours
    const dailyCapacity = new Map<string, number>()
    let totalCapacityHours = 0
    let workingDaysCount = 0

    for (let i = 0; i < days.length; i++) {
      const dayIso = days[i] ?? ''
      const dayDate = dayDates[i]
      const workable = dayDate ? isCalendarWorkday(dayDate, input.calendar) : false
      if (!workable || offSet.has(dayIso)) {
        dailyCapacity.set(dayIso, 0)
        continue
      }
      dailyCapacity.set(dayIso, baseHours)
      totalCapacityHours += baseHours
      if (baseHours > 0) workingDaysCount++
    }

    return {
      userId,
      dailyCapacity,
      totalCapacityHours,
      workingDaysCount,
    }
  })

  return { rangeStart, rangeEnd, days, byUser }
}

/**
 * Helper de conveniencia: convierte el JSON de `Sprint.capacityPerUser`
 * (almacenado en BD como `unknown`) en un `CapacityOverrideMap` validado.
 *
 * Tolera shape inválidos parciales (filtra entradas con tipos incorrectos)
 * para no romper el cálculo si el JSON se editó a mano. NO lanza.
 */
export function parseCapacityOverrides(raw: unknown): CapacityOverrideMap {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const out: CapacityOverrideMap = {}
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!userId || typeof userId !== 'string') continue
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    const v = value as Record<string, unknown>
    const entry: CapacityOverridePerUser = {}
    if (typeof v.dailyHours === 'number' && v.dailyHours >= 0) {
      entry.dailyHours = v.dailyHours
    }
    if (Array.isArray(v.off)) {
      const off = v.off.filter(
        (s): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s),
      )
      if (off.length > 0) entry.off = off
    }
    if (entry.dailyHours !== undefined || entry.off !== undefined) {
      out[userId] = entry
    }
  }
  return out
}

/**
 * Devuelve la capacidad de un día puntual cruzando capacity y workload.
 * Útil para `AvailableUsersFilter` — un usuario está "disponible en X
 * fecha" si `capacity(X) - load(X) >= requestedHours`.
 */
export function dailySlack(
  capacity: number,
  load: number,
  requestedHours = 0,
): number {
  return capacity - load - requestedHours
}

/** Re-exporta toIsoDay para los callers que sólo importan capacity-calc. */
export { toIsoDay }
