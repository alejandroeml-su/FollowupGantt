'use client'

import type { BurndownPoint } from '@/lib/agile/burndown'

/**
 * Chart de Burndown (ideal vs actual) renderizado con SVG nativo.
 *
 * `actualRemaining === null` indica "día futuro": esos puntos no se dibujan
 * en la línea actual (el chart corta donde haya el último valor non-null).
 */
export interface BurndownChartProps {
  data: BurndownPoint[]
  width?: number
  height?: number
}

export function BurndownChart({
  data,
  width = 640,
  height = 280,
}: BurndownChartProps) {
  if (data.length === 0) {
    return (
      <div
        data-testid="burndown-chart-empty"
        className="flex items-center justify-center rounded-lg border border-border bg-card/30 p-8 text-sm text-muted-foreground"
      >
        Sin datos para el burndown.
      </div>
    )
  }

  const padding = { top: 16, right: 16, bottom: 36, left: 40 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxValue = Math.max(
    1,
    ...data.map((d) =>
      Math.max(d.idealRemaining, d.actualRemaining ?? 0),
    ),
  )
  const yTicks = 4
  const niceMax = Math.max(1, Math.ceil(maxValue / yTicks) * yTicks)

  const xScale = (day: number) =>
    data.length === 1 ? 0 : (day / (data.length - 1)) * innerW
  const yScale = (v: number) => innerH - (v / niceMax) * innerH

  const idealPath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(d.day)},${yScale(d.idealRemaining)}`)
    .join(' ')

  const actualPoints = data.filter((d) => d.actualRemaining !== null)
  const actualPath = actualPoints
    .map(
      (d, i) =>
        `${i === 0 ? 'M' : 'L'}${xScale(d.day)},${yScale(d.actualRemaining as number)}`,
    )
    .join(' ')

  return (
    <svg
      role="img"
      aria-label="Burndown del sprint"
      data-testid="burndown-chart"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-3xl text-foreground"
    >
      <g transform={`translate(${padding.left},${padding.top})`}>
        {/* Grilla horizontal + labels Y */}
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

        {/* Línea ideal (gris discontinua) */}
        <path
          d={idealPath}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          data-testid="burndown-ideal"
        />

        {/* Línea actual (cian sólida) */}
        {actualPoints.length > 0 && (
          <path
            d={actualPath}
            fill="none"
            className="stroke-cyan-500"
            strokeWidth={2}
            data-testid="burndown-actual"
          />
        )}

        {/* Puntos de la línea actual */}
        {actualPoints.map((d) => (
          <circle
            key={d.day}
            cx={xScale(d.day)}
            cy={yScale(d.actualRemaining as number)}
            r={3}
            className="fill-cyan-500"
          >
            <title>
              Día {d.day} ({d.date}): {d.actualRemaining} pts
            </title>
          </circle>
        ))}

        {/* Eje X (labels cada N para no saturar) */}
        <line
          x1={0}
          x2={innerW}
          y1={innerH}
          y2={innerH}
          stroke="currentColor"
          strokeOpacity={0.3}
        />
        {data
          .filter((_, i) => i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 6) === 0)
          .map((d) => (
            <text
              key={d.day}
              x={xScale(d.day)}
              y={innerH + 14}
              textAnchor="middle"
              className="fill-current text-[10px] opacity-70"
            >
              {d.day}
            </text>
          ))}
      </g>

      {/* Leyenda */}
      <g transform={`translate(${padding.left},${height - 12})`}>
        <line x1={0} y1={4} x2={20} y2={4} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="4 4" />
        <text x={26} y={8} className="fill-current text-[10px] opacity-80">
          Ideal
        </text>
        <line x1={80} y1={4} x2={100} y2={4} className="stroke-cyan-500" strokeWidth={2} />
        <text x={106} y={8} className="fill-current text-[10px] opacity-80">
          Actual
        </text>
      </g>
    </svg>
  )
}

export default BurndownChart
