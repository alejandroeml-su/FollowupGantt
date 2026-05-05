'use client'

/**
 * WorkloadChart (Ola P8 · Equipo P8-1).
 *
 * Renderiza la carga vs capacidad por día y usuario como vertical bars
 * apiladas en SVG inline. Sin dependencias externas (Recharts/Chart.js
 * no están disponibles en este stack):
 *
 *   - Capacidad: barra gris de 0 a `capacity`.
 *   - Carga: barra azul superpuesta de 0 a `load`. Si `load > capacity`
 *     ⇒ pinta el exceso en rojo.
 *   - Hover: tooltip con desglose de tasks contribuyendo.
 *
 * Layout: una "fila" SVG por usuario (etiqueta a la izquierda + chart
 * scrollable horizontal). Cada barra es 22px ancha, gap 6px ⇒ permite
 * mostrar ~30 días sin scroll en pantalla típica.
 *
 * Accesibilidad: barras con `role="img"` y `aria-label` describiendo
 * "carga / capacidad / overload" en horas.
 */

import { useMemo, useState } from 'react'
import {
  utilizationRatio,
} from '@/lib/resources/workload-calc'

export interface WorkloadChartEntry {
  userId: string
  userName: string
  dailyLoad: Array<{ date: string; hours: number }>
  dailyCapacity: Array<{ date: string; hours: number }>
  contributionsByDay?: Array<{
    date: string
    items: Array<{ taskId: string; taskTitle: string; hours: number }>
  }>
  totalOverloadDays: number
  totalOverloadHours: number
  peakDailyHours: number
}

export interface WorkloadChartProps {
  entries: WorkloadChartEntry[]
  /** Días ISO YYYY-MM-DD. */
  days: string[]
  /** h/día por defecto (default 8). Si capacity es 0 ese día ⇒ no laborable. */
  defaultCapacity?: number
  /** Alto en px de cada chart row. Default 120. */
  rowHeight?: number
}

const BAR_WIDTH = 18
const BAR_GAP = 6
const LEFT_LABEL_WIDTH = 160
const PADDING_TOP = 12
const PADDING_BOTTOM = 22

interface TooltipState {
  userId: string
  date: string
  load: number
  capacity: number
  contributions: Array<{ taskId: string; taskTitle: string; hours: number }>
  x: number
  y: number
}

function formatDayShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function isWeekStart(iso: string): boolean {
  // Marcamos lunes (UTC) como tick mayor en eje X
  const d = new Date(`${iso}T00:00:00.000Z`)
  return d.getUTCDay() === 1
}

export function WorkloadChart({
  entries,
  days,
  defaultCapacity = 8,
  rowHeight = 120,
}: WorkloadChartProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const loadByEntry = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const e of entries) {
      const m = new Map<string, number>()
      for (const x of e.dailyLoad) m.set(x.date, x.hours)
      map.set(e.userId, m)
    }
    return map
  }, [entries])

  const capByEntry = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const e of entries) {
      const m = new Map<string, number>()
      for (const x of e.dailyCapacity) m.set(x.date, x.hours)
      map.set(e.userId, m)
    }
    return map
  }, [entries])

  const contribByEntry = useMemo(() => {
    const map = new Map<
      string,
      Map<string, Array<{ taskId: string; taskTitle: string; hours: number }>>
    >()
    for (const e of entries) {
      const m = new Map<
        string,
        Array<{ taskId: string; taskTitle: string; hours: number }>
      >()
      for (const x of e.contributionsByDay ?? []) m.set(x.date, x.items)
      map.set(e.userId, m)
    }
    return map
  }, [entries])

  const yMax = useMemo(() => {
    let max = defaultCapacity * 1.1
    for (const e of entries) {
      if (e.peakDailyHours > max) max = e.peakDailyHours * 1.1
      for (const c of e.dailyCapacity) {
        if (c.hours > max) max = c.hours
      }
    }
    if (!Number.isFinite(max) || max <= 0) max = 8
    return Math.ceil(max)
  }, [entries, defaultCapacity])

  if (entries.length === 0 || days.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground"
        data-testid="workload-chart-empty"
      >
        No hay datos de carga para el rango seleccionado.
      </div>
    )
  }

  const chartWidth = days.length * (BAR_WIDTH + BAR_GAP) + LEFT_LABEL_WIDTH + 16
  const totalHeight = entries.length * rowHeight + PADDING_TOP

  function handleEnter(
    userId: string,
    date: string,
    load: number,
    capacity: number,
    x: number,
    y: number,
  ) {
    const contribs = contribByEntry.get(userId)?.get(date) ?? []
    setTooltip({
      userId,
      date,
      load,
      capacity,
      contributions: contribs,
      x: x + LEFT_LABEL_WIDTH + 24,
      y: y + 8,
    })
  }
  function handleLeave() {
    setTooltip(null)
  }

  return (
    <div
      className="relative rounded-xl border border-border bg-card overflow-x-auto"
      data-testid="workload-chart"
    >
      <svg
        width={chartWidth}
        height={totalHeight}
        role="img"
        aria-label="Carga vs capacidad por día y usuario"
      >
        {entries.map((entry, idx) => {
          const rowY = PADDING_TOP + idx * rowHeight
          const innerH = rowHeight - PADDING_TOP - PADDING_BOTTOM
          const yScale = (h: number) => (h / yMax) * innerH
          const capMap = capByEntry.get(entry.userId)
          const loadMap = loadByEntry.get(entry.userId)
          return (
            <g key={entry.userId} data-testid={`row-${entry.userId}`}>
              {/* Etiqueta de usuario (a la izquierda) */}
              <text
                x={8}
                y={rowY + innerH / 2}
                fill="#fff"
                fontSize={12}
                fontWeight={500}
                dominantBaseline="middle"
              >
                {entry.userName}
              </text>
              <text
                x={8}
                y={rowY + innerH / 2 + 16}
                fill="#9ca3af"
                fontSize={10}
                dominantBaseline="middle"
              >
                {entry.totalOverloadDays > 0
                  ? `${entry.totalOverloadDays}d sobrecarga`
                  : 'sin sobrecarga'}
              </text>

              {/* Línea base (eje X) */}
              <line
                x1={LEFT_LABEL_WIDTH}
                x2={chartWidth - 8}
                y1={rowY + innerH}
                y2={rowY + innerH}
                stroke="#374151"
                strokeWidth={1}
              />

              {/* Barras por día */}
              {days.map((day, dayIdx) => {
                const x =
                  LEFT_LABEL_WIDTH + dayIdx * (BAR_WIDTH + BAR_GAP) + 4
                const cap = capMap?.get(day) ?? 0
                const load = loadMap?.get(day) ?? 0
                const overload = Math.max(0, load - cap)
                const loadVisible = Math.min(load, cap)
                const capH = yScale(cap)
                const loadH = yScale(loadVisible)
                const overloadH = yScale(overload)
                const ratio = utilizationRatio(load, cap || defaultCapacity)
                const baseY = rowY + innerH

                return (
                  <g
                    key={`${entry.userId}-${day}`}
                    data-testid={`bar-${entry.userId}-${day}`}
                    onMouseEnter={() =>
                      handleEnter(entry.userId, day, load, cap, x, rowY)
                    }
                    onMouseLeave={handleLeave}
                    onFocus={() =>
                      handleEnter(entry.userId, day, load, cap, x, rowY)
                    }
                    onBlur={handleLeave}
                    tabIndex={0}
                  >
                    <title>
                      {`${day} · carga ${load.toFixed(1)}h / capacidad ${cap.toFixed(1)}h`}
                      {overload > 0 ? ` · overload ${overload.toFixed(1)}h` : ''}
                    </title>
                    {/* Capacidad (gris) */}
                    {cap > 0 && (
                      <rect
                        x={x}
                        y={baseY - capH}
                        width={BAR_WIDTH}
                        height={capH}
                        fill="#1f2937"
                        stroke="#374151"
                        strokeWidth={1}
                        data-testid={`cap-${entry.userId}-${day}`}
                      />
                    )}
                    {/* Carga normal (azul) */}
                    {loadVisible > 0 && (
                      <rect
                        x={x}
                        y={baseY - loadH}
                        width={BAR_WIDTH}
                        height={loadH}
                        fill={ratio > 1 ? '#dc2626' : '#3b82f6'}
                        data-testid={`load-${entry.userId}-${day}`}
                      />
                    )}
                    {/* Overload (rojo, encima de la capacidad) */}
                    {overload > 0 && (
                      <rect
                        x={x}
                        y={baseY - capH - overloadH}
                        width={BAR_WIDTH}
                        height={overloadH}
                        fill="#dc2626"
                        data-testid={`overload-${entry.userId}-${day}`}
                      />
                    )}
                    {/* Marca % a la derecha (cuando hay carga) */}
                    {load > 0 && (
                      <text
                        x={x + BAR_WIDTH / 2}
                        y={baseY - capH - overloadH - 4}
                        fill={ratio > 1 ? '#fca5a5' : '#9ca3af'}
                        fontSize={9}
                        textAnchor="middle"
                      >
                        {Math.round(ratio * 100)}%
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Eje X (ticks de días) */}
              {days.map((day, dayIdx) => {
                const x =
                  LEFT_LABEL_WIDTH + dayIdx * (BAR_WIDTH + BAR_GAP) + 4
                const major = isWeekStart(day)
                return (
                  <text
                    key={`tick-${entry.userId}-${day}`}
                    x={x + BAR_WIDTH / 2}
                    y={rowY + innerH + 14}
                    fill={major ? '#e5e7eb' : '#6b7280'}
                    fontSize={major ? 10 : 9}
                    fontWeight={major ? 600 : 400}
                    textAnchor="middle"
                  >
                    {formatDayShort(day)}
                  </text>
                )
              })}
            </g>
          )
        })}
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs rounded-md border border-border bg-popover/95 px-3 py-2 text-xs text-foreground shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
          data-testid="workload-chart-tooltip"
        >
          <div className="mb-1 font-semibold text-white">
            {tooltip.date}
          </div>
          <div className="text-muted-foreground">
            Carga: {tooltip.load.toFixed(1)}h / Capacidad: {tooltip.capacity.toFixed(1)}h
            {tooltip.load > tooltip.capacity && tooltip.capacity > 0 && (
              <span className="ml-2 text-red-400">
                +{(tooltip.load - tooltip.capacity).toFixed(1)}h
              </span>
            )}
          </div>
          {tooltip.contributions.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {tooltip.contributions.map((c) => (
                <li key={c.taskId} className="truncate">
                  · {c.taskTitle} · {c.hours.toFixed(1)}h
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
