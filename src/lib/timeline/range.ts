/**
 * US-4.2 Timeline View — helpers de rango/zoom y posicionamiento.
 *
 * Convención: todas las fechas se normalizan a UTC midnight para evitar
 * drift por zona horaria. Las posiciones en eje X se calculan como
 * porcentaje [0..100] del total de la ventana.
 */

import type { TimelineWindow, TimelineZoom } from './types'

const MS_PER_DAY = 86_400_000

function startOfDayUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

const MONTH_LABELS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]

/**
 * Calcula la ventana visible para el zoom dado, anclada al `anchor`
 * (default: hoy). Cada zoom define cuántos "buckets" se muestran.
 */
export function buildTimelineWindow(
  zoom: TimelineZoom,
  anchor: Date = new Date(),
): TimelineWindow {
  const today = startOfDayUTC(anchor)
  let start: Date
  let end: Date

  switch (zoom) {
    case 'WEEKS': {
      // 12 semanas centradas en hoy: 4 atrás + 8 adelante
      const dayOfWeek = today.getUTCDay() // 0=Sun
      const monday = new Date(
        today.getTime() - ((dayOfWeek === 0 ? 6 : dayOfWeek - 1) * MS_PER_DAY),
      )
      start = new Date(monday.getTime() - 4 * 7 * MS_PER_DAY)
      end = new Date(monday.getTime() + 8 * 7 * MS_PER_DAY)
      break
    }
    case 'MONTHS': {
      // 12 meses: 3 atrás + 9 adelante
      const y = today.getUTCFullYear()
      const m = today.getUTCMonth()
      start = new Date(Date.UTC(y, m - 3, 1))
      end = new Date(Date.UTC(y, m + 9, 1))
      break
    }
    case 'QUARTERS': {
      // 8 trimestres (2 años): 2 atrás + 6 adelante
      const y = today.getUTCFullYear()
      const m = today.getUTCMonth()
      const qStart = m - (m % 3)
      start = new Date(Date.UTC(y, qStart - 6, 1))
      end = new Date(Date.UTC(y, qStart + 18, 1))
      break
    }
  }

  const totalDays = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)

  // Major + minor ticks según zoom.
  const majorTicks: TimelineWindow['majorTicks'] = []
  const minorTicks: TimelineWindow['minorTicks'] = []

  if (zoom === 'WEEKS') {
    // Major: meses; Minor: semanas (lunes de cada semana)
    let cursor = new Date(start)
    while (cursor < end) {
      const monthStart = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1),
      )
      if (
        monthStart >= start &&
        monthStart < end &&
        !majorTicks.some((t) => t.date.getTime() === monthStart.getTime())
      ) {
        majorTicks.push({
          date: monthStart,
          label: `${MONTH_LABELS[monthStart.getUTCMonth()]} ${monthStart.getUTCFullYear()}`,
          positionPct: positionPct(monthStart, start, totalDays),
        })
      }
      // Minor: cada lunes (primera semana ya empieza en lunes por construcción)
      minorTicks.push({
        date: new Date(cursor),
        positionPct: positionPct(cursor, start, totalDays),
      })
      cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY)
    }
  } else if (zoom === 'MONTHS') {
    // Major: trimestre/año; Minor: meses
    let cursor = new Date(start)
    while (cursor < end) {
      const m = cursor.getUTCMonth()
      if (m % 3 === 0) {
        majorTicks.push({
          date: new Date(cursor),
          label: `Q${Math.floor(m / 3) + 1} ${cursor.getUTCFullYear()}`,
          positionPct: positionPct(cursor, start, totalDays),
        })
      }
      minorTicks.push({
        date: new Date(cursor),
        positionPct: positionPct(cursor, start, totalDays),
      })
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), m + 1, 1))
    }
  } else {
    // QUARTERS: Major = año; Minor = trimestres
    let cursor = new Date(start)
    while (cursor < end) {
      const m = cursor.getUTCMonth()
      if (m === 0) {
        majorTicks.push({
          date: new Date(cursor),
          label: String(cursor.getUTCFullYear()),
          positionPct: positionPct(cursor, start, totalDays),
        })
      }
      minorTicks.push({
        date: new Date(cursor),
        positionPct: positionPct(cursor, start, totalDays),
      })
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), m + 3, 1))
    }
  }

  const fmt = (d: Date) =>
    `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  const label = `${fmt(start)} – ${fmt(new Date(end.getTime() - MS_PER_DAY))}`

  return { start, end, totalDays, label, majorTicks, minorTicks }
}

export function positionPct(date: Date, start: Date, totalDays: number): number {
  const days = (date.getTime() - start.getTime()) / MS_PER_DAY
  return Math.max(0, Math.min(100, (days / totalDays) * 100))
}

/**
 * Convierte un rango task → bar geometry { leftPct, widthPct, clamped }.
 * Si la task está fuera de la ventana, devuelve null.
 * Si la task se sale parcialmente, recorta a los bordes.
 */
export function taskBarGeometry(
  taskStart: Date,
  taskEnd: Date,
  win: { start: Date; end: Date; totalDays: number },
): { leftPct: number; widthPct: number; clampedLeft: boolean; clampedRight: boolean } | null {
  const ts = startOfDayUTC(taskStart)
  const te = startOfDayUTC(taskEnd)
  if (te < win.start) return null
  if (ts >= win.end) return null
  const visStart = ts < win.start ? win.start : ts
  const visEnd = te > win.end ? win.end : te
  // +1 día para incluir el día de fin (cerrado)
  const visEndPlus = new Date(visEnd.getTime() + MS_PER_DAY)
  const leftPct = positionPct(visStart, win.start, win.totalDays)
  const rightPct = positionPct(visEndPlus, win.start, win.totalDays)
  return {
    leftPct,
    widthPct: Math.max(0.5, rightPct - leftPct),
    clampedLeft: ts < win.start,
    clampedRight: te > win.end,
  }
}

/** Posición de la línea "hoy" en la ventana (0-100), o null si fuera. */
export function todayMarkerPct(win: {
  start: Date
  end: Date
  totalDays: number
}): number | null {
  const today = startOfDayUTC(new Date())
  if (today < win.start || today >= win.end) return null
  return positionPct(today, win.start, win.totalDays)
}
