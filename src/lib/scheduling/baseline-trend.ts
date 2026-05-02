/**
 * HU-3.4 · Cálculo puro de la evolución mensual SV/SPI vs línea base.
 *
 * Recibe el snapshot de la línea base activa y las tareas reales del
 * proyecto, y reduce a una serie temporal mensual con PV, EV, SV y SPI.
 * La salida alimenta el `<BaselineTrendChart/>` (SVG nativo) y la
 * `<BaselineTrendTable/>` complementaria.
 *
 * Convenciones EVM:
 *  - PV (Planned Value): valor planificado acumulado a fin del mes,
 *    derivado de las tareas en el snapshot cuya `plannedEnd` cae en
 *    o antes del último día del mes.
 *  - EV (Earned Value): valor ganado acumulado a fin del mes, derivado
 *    de las tareas reales — `earnedValue` directo si está, fallback a
 *    `plannedValue * progress/100`.
 *  - SV (Schedule Variance): EV − PV. Positivo = adelanto.
 *  - SPI (Schedule Performance Index): EV / PV. 1.0 = en plan.
 *
 * Estos cálculos son monetarios — la magnitud absoluta depende del
 * `plannedValue` registrado por proyecto. Las series son acumuladas
 * (cada mes refleja el total al cierre, no el delta del mes), lo que
 * facilita inspección visual en SVG.
 *
 * Identifiers en inglés (D9). Strings de UI en español los aplica el
 * componente que consume estos datos.
 */

import type { BaselineSnapshot } from './baseline-snapshot'

// ───────────────────────── Tipos ─────────────────────────

export type MonthlyPoint = {
  /** Primer día del mes UTC (etiqueta canónica). */
  month: Date
  /** Etiqueta corta YYYY-MM, útil para keys y series. */
  monthKey: string
  pv: number
  ev: number
  /** SV = EV − PV. */
  sv: number
  /** SPI = EV / PV (null si PV=0 ese mes). */
  spi: number | null
}

/** Tarea real mínima para el cálculo. */
export type TaskForTrend = {
  id: string
  startDate: string | null
  endDate: string | null
  plannedValue: number | null
  earnedValue: number | null
  progress: number | null
}

// ───────────────────────── Helpers ─────────────────────────

function parseIso(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** Primer día del mes UTC para una fecha dada. */
function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

/** Último instante del mes UTC (último día, 23:59:59.999). */
function endOfMonthUtc(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  )
}

function nextMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** EV de una tarea: prefiere `earnedValue` explícito, fallback a PV * progress. */
function earnedValueOf(t: TaskForTrend): number {
  if (t.earnedValue != null) return t.earnedValue
  const pv = t.plannedValue ?? 0
  const p = t.progress ?? 0
  return pv * (Math.max(0, Math.min(100, p)) / 100)
}

// ───────────────────────── API ─────────────────────────

/**
 * Calcula la trend mensual entre el primer mes con `plannedStart` y
 * el último con `plannedEnd` o `endDate` real (tomamos el máximo). Si
 * el rango colapsa o no hay tareas, retorna `[]`.
 *
 * Nota P0: usamos los valores monetarios (PV/EV) tal como quedan en
 * BD. Si el proyecto no carga `plannedValue`, la curva queda plana en
 * 0 — esto es transparente en el chart (se ven barras vacías y SPI
 * null).
 */
export function computeBaselineTrend(
  snapshot: BaselineSnapshot,
  currentTasks: readonly TaskForTrend[],
): MonthlyPoint[] {
  if (snapshot.tasks.length === 0 && currentTasks.length === 0) return []

  // Rango: min(plannedStart) ... max(plannedEnd, realEnd).
  const allStartDates: Date[] = []
  const allEndDates: Date[] = []
  for (const bt of snapshot.tasks) {
    const ps = parseIso(bt.plannedStart)
    const pe = parseIso(bt.plannedEnd)
    if (ps) allStartDates.push(ps)
    if (pe) allEndDates.push(pe)
  }
  for (const t of currentTasks) {
    const e = parseIso(t.endDate)
    if (e) allEndDates.push(e)
  }
  if (allStartDates.length === 0 || allEndDates.length === 0) return []

  const minStart = new Date(Math.min(...allStartDates.map((d) => d.getTime())))
  const maxEnd = new Date(Math.max(...allEndDates.map((d) => d.getTime())))

  // Iteramos por mes UTC inclusive.
  const months: Date[] = []
  let cursor = startOfMonthUtc(minStart)
  const lastMonth = startOfMonthUtc(maxEnd)
  // Defensa: si por alguna razón min > max, no entres al loop.
  if (cursor.getTime() > lastMonth.getTime()) return []
  // Cap defensivo a 60 meses (5 años) — evita loops anómalos si el
  // dataset tiene una fecha corrupta. Para proyectos típicos (≤24
  // meses) es invisible.
  let safety = 60
  while (cursor.getTime() <= lastMonth.getTime() && safety-- > 0) {
    months.push(cursor)
    cursor = nextMonthUtc(cursor)
  }

  // Map id → task real para EV.
  const realById = new Map<string, TaskForTrend>()
  for (const t of currentTasks) realById.set(t.id, t)

  const out: MonthlyPoint[] = months.map((m) => {
    const eom = endOfMonthUtc(m)
    let pv = 0
    let ev = 0
    for (const bt of snapshot.tasks) {
      const pe = parseIso(bt.plannedEnd)
      if (!pe) continue
      // PV: tareas cuya planificación termina en o antes de fin de mes.
      if (pe.getTime() <= eom.getTime()) {
        pv += bt.plannedValue ?? 0
      }
      // EV: si la tarea real correspondiente alcanzó esa fecha real
      // (endDate ≤ eom), contribuye con su earnedValue. Esto modela
      // "valor entregado al cierre del mes" según fechas reales.
      const real = realById.get(bt.id)
      if (real) {
        const realEnd = parseIso(real.endDate)
        if (realEnd && realEnd.getTime() <= eom.getTime()) {
          ev += earnedValueOf(real)
        }
      }
    }
    const sv = ev - pv
    const spi = pv > 0 ? ev / pv : null
    return { month: m, monthKey: monthKey(m), pv, ev, sv, spi }
  })

  return out
}

/**
 * Devuelve los últimos `n` puntos de la serie. Si la serie es más
 * corta, devuelve la serie completa. Útil para la tabla de los
 * últimos 6 meses del panel.
 */
export function takeLastN<T>(arr: readonly T[], n: number): T[] {
  if (n <= 0) return []
  if (arr.length <= n) return arr.slice()
  return arr.slice(arr.length - n)
}

/** Etiqueta legible "may 2026" — el caller decide localización adicional. */
export function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
