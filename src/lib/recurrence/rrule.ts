/**
 * Ola P2 · Equipo P2-3 — Subset iCalendar RRULE.
 *
 * Implementación minimalista (sin dependencias) suficiente para nuestros
 * casos de uso:
 *   - Frecuencias DAILY / WEEKLY / MONTHLY / YEARLY.
 *   - `interval` (cada N freqs).
 *   - `byweekday` (Lun=0..Dom=6) — sólo aplica con WEEKLY.
 *   - `bymonthday` (1..31) — sólo aplica con MONTHLY/YEARLY.
 *   - Terminación por `count` (máx ocurrencias) y/o `endDate` (inclusive).
 *
 * Decisiones autónomas:
 *   D-RR-1: Trabajamos siempre en UTC midnight para evitar drift por DST.
 *           El cron corre en server (UTC), las fechas se persisten como
 *           `DateTime` (UTC). Quien quiera mostrar local-time hace shift
 *           en cliente.
 *   D-RR-2: El "anchor" semanal es el `startDate.weekday`. Si `byweekday`
 *           está vacío, sólo se materializa ese weekday cada `interval`
 *           semanas. Si tiene valores, expandimos cada weekday listado
 *           dentro de las semanas activas.
 *   D-RR-3: `bymonthday` con días que no existen en el mes (ej. 31 en
 *           febrero) se SALTA, no se "clampa". Es la semántica RFC 5545
 *           y la más predecible para usuarios.
 *   D-RR-4: `expandOccurrences` está acotado por un techo defensivo
 *           (`MAX_OCCURRENCES_HARD_CAP`) para evitar bucles infinitos
 *           en reglas mal formadas que llegasen sin pasar por
 *           `validateRule`.
 *
 * Errores tipados: `validateRule` NO lanza — devuelve `{ ok: false, errors }`.
 * Las server actions traducen esos errores a `[INVALID_RRULE]` cuando aplica.
 */

export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export type RRule = {
  frequency: RecurrenceFreq
  interval: number
  byweekday: number[]
  bymonthday: number[]
  startDate: Date
  endDate?: Date | null
  count?: number | null
}

export type ValidationResult =
  | { ok: true; errors?: undefined }
  | { ok: false; errors: string[] }

const MAX_OCCURRENCES_HARD_CAP = 5000
const MAX_INTERVAL = 999

// ──────────────────────── Utilidades de fecha ────────────────────────

/**
 * Devuelve una nueva fecha con el mismo Y/M/D que `d` pero en UTC midnight.
 */
function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime())
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime())
  // Anchor el día — si overflow al mes siguiente, JS auto-rolls. Para
  // evitarlo seteamos día=1 antes y luego reaplicamos.
  const day = r.getUTCDate()
  r.setUTCDate(1)
  r.setUTCMonth(r.getUTCMonth() + n)
  // Ajustar el día solo si cabe (ej. 31 ene → +1 mes ≠ 31 feb).
  const lastDay = lastDayOfMonth(r.getUTCFullYear(), r.getUTCMonth())
  r.setUTCDate(Math.min(day, lastDay))
  return r
}

function addYears(d: Date, n: number): Date {
  const r = new Date(d.getTime())
  r.setUTCFullYear(r.getUTCFullYear() + n)
  return r
}

function lastDayOfMonth(year: number, monthIdx: number): number {
  // monthIdx 0..11 → último día del mes.
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()
}

/**
 * ISO weekday menos 1 → Lun=0..Dom=6. JS getUTCDay() → Dom=0..Sáb=6.
 */
function isoWeekday(d: Date): number {
  const js = d.getUTCDay() // Dom=0..Sáb=6
  return js === 0 ? 6 : js - 1
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

// ──────────────────────── Validación ────────────────────────

export function validateRule(rule: Partial<RRule>): ValidationResult {
  const errors: string[] = []

  if (!rule.frequency || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.frequency)) {
    errors.push('frequency inválida (DAILY, WEEKLY, MONTHLY, YEARLY)')
  }

  if (
    rule.interval == null ||
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > MAX_INTERVAL
  ) {
    errors.push(`interval debe ser entero 1..${MAX_INTERVAL}`)
  }

  if (!(rule.startDate instanceof Date) || Number.isNaN(rule.startDate.getTime())) {
    errors.push('startDate inválida')
  }

  if (rule.endDate != null) {
    if (!(rule.endDate instanceof Date) || Number.isNaN(rule.endDate.getTime())) {
      errors.push('endDate inválida')
    } else if (
      rule.startDate instanceof Date &&
      !Number.isNaN(rule.startDate.getTime()) &&
      rule.endDate.getTime() < rule.startDate.getTime()
    ) {
      errors.push('endDate debe ser posterior o igual a startDate')
    }
  }

  if (rule.count != null) {
    if (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > MAX_OCCURRENCES_HARD_CAP) {
      errors.push(`count debe ser entero 1..${MAX_OCCURRENCES_HARD_CAP}`)
    }
  }

  if (rule.byweekday != null) {
    if (!Array.isArray(rule.byweekday)) {
      errors.push('byweekday debe ser array')
    } else {
      for (const w of rule.byweekday) {
        if (!Number.isInteger(w) || w < 0 || w > 6) {
          errors.push(`byweekday inválido: ${String(w)} (rango 0..6)`)
        }
      }
      if (rule.byweekday.length > 0 && rule.frequency !== 'WEEKLY') {
        errors.push('byweekday solo aplica a frequency=WEEKLY')
      }
    }
  }

  if (rule.bymonthday != null) {
    if (!Array.isArray(rule.bymonthday)) {
      errors.push('bymonthday debe ser array')
    } else {
      for (const md of rule.bymonthday) {
        if (!Number.isInteger(md) || md < 1 || md > 31) {
          errors.push(`bymonthday inválido: ${String(md)} (rango 1..31)`)
        }
      }
      if (rule.bymonthday.length > 0 && rule.frequency !== 'MONTHLY' && rule.frequency !== 'YEARLY') {
        errors.push('bymonthday solo aplica a frequency=MONTHLY o YEARLY')
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true }
}

// ──────────────────────── Generador interno ────────────────────────

function normalizeRule(rule: RRule): RRule {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    byweekday: [...rule.byweekday].sort((a, b) => a - b),
    bymonthday: [...rule.bymonthday].sort((a, b) => a - b),
    startDate: toUtcMidnight(rule.startDate),
    endDate: rule.endDate ? toUtcMidnight(rule.endDate) : null,
    count: rule.count ?? null,
  }
}

/**
 * Itera ocurrencias en orden ascendente. Llama a `emit(date)`; si el
 * callback devuelve `false`, detiene la iteración. Devuelve la cantidad
 * total emitida.
 */
function iterateOccurrences(rule: RRule, emit: (date: Date) => boolean): number {
  const r = normalizeRule(rule)
  const start = r.startDate
  const cap = r.count ?? MAX_OCCURRENCES_HARD_CAP
  let emitted = 0

  switch (r.frequency) {
    case 'DAILY': {
      let cur = start
      while (emitted < cap) {
        if (r.endDate && cur.getTime() > r.endDate.getTime()) break
        if (emitted >= MAX_OCCURRENCES_HARD_CAP) break
        if (!emit(cur)) return emitted
        emitted++
        cur = addDays(cur, r.interval)
      }
      return emitted
    }
    case 'WEEKLY': {
      // Trabajamos en bloques de "semana ancla" — el primer día de la
      // semana que toca según interval. El día base es startDate.
      const baseWd = isoWeekday(start)
      const targets = r.byweekday.length > 0 ? r.byweekday : [baseWd]
      // Lunes de la semana de start (anchor).
      const weekAnchor = addDays(start, -baseWd)
      let weekIdx = 0
      while (emitted < cap) {
        if (emitted >= MAX_OCCURRENCES_HARD_CAP) break
        const weekStart = addDays(weekAnchor, weekIdx * 7 * r.interval)
        let blockOverflow = false
        for (const wd of targets) {
          const candidate = addDays(weekStart, wd)
          if (candidate.getTime() < start.getTime()) continue
          if (r.endDate && candidate.getTime() > r.endDate.getTime()) {
            blockOverflow = true
            break
          }
          if (emitted >= cap) break
          if (!emit(candidate)) return emitted
          emitted++
        }
        if (blockOverflow) break
        weekIdx++
        // Defensivo: techo absoluto en iteraciones de bloque.
        if (weekIdx > MAX_OCCURRENCES_HARD_CAP) break
      }
      return emitted
    }
    case 'MONTHLY': {
      const baseDay = start.getUTCDate()
      const targets = r.bymonthday.length > 0 ? r.bymonthday : [baseDay]
      let monthIdx = 0
      while (emitted < cap) {
        if (emitted >= MAX_OCCURRENCES_HARD_CAP) break
        const monthAnchor = addMonths(start, monthIdx * r.interval)
        const yr = monthAnchor.getUTCFullYear()
        const mo = monthAnchor.getUTCMonth()
        const lastDay = lastDayOfMonth(yr, mo)
        let blockOverflow = false
        for (const md of targets) {
          if (md > lastDay) continue // D-RR-3: skip día inexistente.
          const candidate = new Date(Date.UTC(yr, mo, md))
          if (candidate.getTime() < start.getTime()) continue
          if (r.endDate && candidate.getTime() > r.endDate.getTime()) {
            blockOverflow = true
            break
          }
          if (emitted >= cap) break
          if (!emit(candidate)) return emitted
          emitted++
        }
        if (blockOverflow) break
        monthIdx++
        if (monthIdx > MAX_OCCURRENCES_HARD_CAP) break
      }
      return emitted
    }
    case 'YEARLY': {
      const baseMonth = start.getUTCMonth()
      const baseDay = start.getUTCDate()
      const targets = r.bymonthday.length > 0 ? r.bymonthday : [baseDay]
      let yearIdx = 0
      while (emitted < cap) {
        if (emitted >= MAX_OCCURRENCES_HARD_CAP) break
        const yearAnchor = addYears(start, yearIdx * r.interval)
        const yr = yearAnchor.getUTCFullYear()
        const lastDay = lastDayOfMonth(yr, baseMonth)
        let blockOverflow = false
        for (const md of targets) {
          if (md > lastDay) continue
          const candidate = new Date(Date.UTC(yr, baseMonth, md))
          if (candidate.getTime() < start.getTime()) continue
          if (r.endDate && candidate.getTime() > r.endDate.getTime()) {
            blockOverflow = true
            break
          }
          if (emitted >= cap) break
          if (!emit(candidate)) return emitted
          emitted++
        }
        if (blockOverflow) break
        yearIdx++
        if (yearIdx > MAX_OCCURRENCES_HARD_CAP) break
      }
      return emitted
    }
    default:
      return emitted
  }
}

// ──────────────────────── API pública ────────────────────────

/**
 * Próxima ocurrencia estrictamente posterior a `after` (excluye duplicados
 * en el mismo día). Devuelve `null` si la regla ya terminó.
 */
export function nextOccurrence(rule: RRule, after: Date): Date | null {
  const target = toUtcMidnight(after)
  let result: Date | null = null
  iterateOccurrences(rule, (date) => {
    if (date.getTime() > target.getTime()) {
      result = date
      return false
    }
    return true
  })
  return result
}

/**
 * Expande todas las ocurrencias (orden ascendente) hasta `until` (inclusive).
 * Respeta `endDate` y `count` además del límite externo.
 */
export function expandOccurrences(rule: RRule, until: Date): Date[] {
  const out: Date[] = []
  const limit = toUtcMidnight(until)
  iterateOccurrences(rule, (date) => {
    if (date.getTime() > limit.getTime()) return false
    out.push(date)
    return true
  })
  return out
}

/**
 * Helper expuesto para la UI: las próximas N ocurrencias después de
 * `from` (default = startDate). Útil para preview en el dialog.
 */
export function previewOccurrences(rule: RRule, max: number, from?: Date): Date[] {
  const fromTs = from ? toUtcMidnight(from).getTime() : -Infinity
  const out: Date[] = []
  iterateOccurrences(rule, (date) => {
    if (date.getTime() < fromTs) return true
    out.push(date)
    if (out.length >= max) return false
    return true
  })
  return out
}

/**
 * Devuelve `true` si la regla puede seguir generando ocurrencias después
 * de `after`. Útil para que el scheduler decida si desactivar la regla.
 */
export function hasFutureOccurrences(rule: RRule, after: Date): boolean {
  return nextOccurrence(rule, after) !== null
}

// Re-export del helper interno (visibilidad restringida a tests/scheduler).
export const __internal = {
  toUtcMidnight,
  isoWeekday,
  sameDay,
}
