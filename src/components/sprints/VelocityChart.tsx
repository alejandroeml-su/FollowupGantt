'use client'

import type { VelocityPoint } from '@/lib/agile/burndown'

/**
 * Chart de Velocity (capacity vs velocityActual) renderizado con SVG nativo.
 *
 * Decisión: SVG nativo (no recharts/d3) porque la decisión P0 fue evitar
 * añadir dependencias de UI; el cálculo viene listo desde `computeVelocity`
 * (orden cronológico ascendente).
 *
 * Layout:
 *  - Eje X: cada sprint (categorical).
 *  - Eje Y: puntos de historia (0 ... maxValue).
 *  - Por cada sprint, un par de barras: capacity (gris claro) y velocity
 *    (cian). Si capacity = 0, sólo se dibuja velocity.
 */
export interface VelocityChartProps {
  data: VelocityPoint[]
  width?: number
  height?: number
}

export function VelocityChart({
  data,
  width = 640,
  height = 280,
}: VelocityChartProps) {
  if (data.length === 0) {
    return (
      <div
        data-testid="velocity-chart-empty"
        className="flex items-center justify-center rounded-lg border border-border bg-card/30 p-8 text-sm text-muted-foreground"
      >
        Aún no hay sprints con datos de velocity.
      </div>
    )
  }

  const padding = { top: 16, right: 16, bottom: 48, left: 40 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxValue = Math.max(
    1,
    ...data.flatMap((d) => [d.capacity, d.velocityActual]),
  )
  const yTicks = 4
  const yStep = Math.ceil(maxValue / yTicks)
  const niceMax = yStep * yTicks

  const groupWidth = innerW / data.length
  const barWidth = Math.max(6, Math.min(36, groupWidth * 0.35))
  const gap = 4

  const yScale = (v: number) => innerH - (v / niceMax) * innerH

  return (
    <svg
      role="img"
      aria-label="Velocity por sprint"
      data-testid="velocity-chart"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-3xl text-foreground"
    >
      <g transform={`translate(${padding.left},${padding.top})`}>
        {/* Líneas horizontales de la grilla + labels Y */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const value = niceMax - (niceMax / yTicks) * i
          const y = (innerH / yTicks) * i
          return (
            <g key={i}>
              <line
                x1={0}
                x2={innerW}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
              />
              <text
                x={-8}
                y={y}
                dy="0.32em"
                textAnchor="end"
                className="fill-current text-[10px] opacity-70"
              >
                {Math.round(value)}
              </text>
            </g>
          )
        })}

        {/* Barras */}
        {data.map((d, i) => {
          const cx = i * groupWidth + groupWidth / 2
          const xCap = cx - barWidth - gap / 2
          const xVel = cx + gap / 2
          const yCap = yScale(d.capacity)
          const yVel = yScale(d.velocityActual)
          return (
            <g key={d.sprintId}>
              <rect
                x={xCap}
                y={yCap}
                width={barWidth}
                height={Math.max(0, innerH - yCap)}
                rx={2}
                className="fill-slate-400/60"
              >
                <title>
                  {d.sprintName} · capacity {d.capacity}
                </title>
              </rect>
              <rect
                x={xVel}
                y={yVel}
                width={barWidth}
                height={Math.max(0, innerH - yVel)}
                rx={2}
                className="fill-cyan-500"
              >
                <title>
                  {d.sprintName} · velocity {d.velocityActual}
                </title>
              </rect>

              <text
                x={cx}
                y={innerH + 14}
                textAnchor="middle"
                className="fill-current text-[10px] opacity-70"
              >
                {d.sprintName.length > 12
                  ? `${d.sprintName.slice(0, 11)}...`
                  : d.sprintName}
              </text>
            </g>
          )
        })}

        {/* Eje X */}
        <line
          x1={0}
          x2={innerW}
          y1={innerH}
          y2={innerH}
          stroke="currentColor"
          strokeOpacity={0.3}
        />
      </g>

      {/* Leyenda */}
      <g transform={`translate(${padding.left},${height - 16})`}>
        <rect width={10} height={10} className="fill-slate-400/60" />
        <text x={16} y={9} className="fill-current text-[10px] opacity-80">
          Capacity
        </text>
        <rect x={80} width={10} height={10} className="fill-cyan-500" />
        <text x={96} y={9} className="fill-current text-[10px] opacity-80">
          Velocity
        </text>
      </g>
    </svg>
  )
}

export default VelocityChart
