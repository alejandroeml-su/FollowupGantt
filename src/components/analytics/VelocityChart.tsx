'use client'

/**
 * Wave P10 (HU-10.3 · GAMMA-1.3) — Velocity chart con banda de confianza.
 *
 * Renderiza barras de velocity histórica (story points por sprint) y una
 * banda P10-P90 superpuesta para el siguiente sprint forecast. Sin librería
 * externa: SVG nativo + escalado lineal sencillo.
 *
 * Props:
 *  - history: array de sprints cerrados (oldest → newest)
 *  - nextSprintForecast: P10/P50/P90 del siguiente sprint (puede ser null)
 *  - title: opcional, default "Velocity"
 */

import type {
  VelocityForecast,
  VelocityHistoryEntry,
} from '@/lib/forecasting/monte-carlo'

type Props = {
  history: VelocityHistoryEntry[]
  nextSprintForecast: VelocityForecast | null
  title?: string
  className?: string
}

const WIDTH = 720
const HEIGHT = 220
const PADDING_X = 40
const PADDING_TOP = 16
const PADDING_BOTTOM = 36
const BAR_GAP = 6

export function VelocityChart({
  history,
  nextSprintForecast,
  title = 'Velocity histórica',
  className,
}: Props) {
  if (history.length === 0) {
    return (
      <div
        className={`rounded-md border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground ${className ?? ''}`}
      >
        Aún no hay sprints cerrados para calcular velocity.
      </div>
    )
  }

  const maxSp = Math.max(
    ...history.map((h) => h.completedSp),
    nextSprintForecast?.p90 ?? 0,
    1,
  )

  const slots = nextSprintForecast ? history.length + 1 : history.length
  const innerWidth = WIDTH - PADDING_X * 2
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const slotWidth = innerWidth / slots
  const barWidth = Math.max(slotWidth - BAR_GAP, 6)

  function yFor(sp: number): number {
    return PADDING_TOP + innerHeight * (1 - sp / maxSp)
  }

  // Tres ticks horizontales: 0, max/2, max
  const ticks = [0, maxSp / 2, maxSp]

  return (
    <div
      className={`rounded-xl border border-border bg-card p-4 ${className ?? ''}`}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {nextSprintForecast && (
          <p className="text-[10px] text-muted-foreground">
            Forecast siguiente sprint · P10 {nextSprintForecast.p10} · P50{' '}
            {nextSprintForecast.p50} · P90 {nextSprintForecast.p90} · σ{' '}
            {nextSprintForecast.stddev}
          </p>
        )}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={title}
      >
        {/* Grid */}
        {ticks.map((t, i) => {
          const y = yFor(t)
          return (
            <g key={i}>
              <line
                x1={PADDING_X}
                x2={WIDTH - PADDING_X}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.12"
                strokeDasharray="2 4"
              />
              <text
                x={PADDING_X - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="currentColor"
                opacity="0.55"
              >
                {Math.round(t)}
              </text>
            </g>
          )
        })}

        {/* Barras histórico */}
        {history.map((h, i) => {
          const x = PADDING_X + i * slotWidth + (slotWidth - barWidth) / 2
          const y = yFor(h.completedSp)
          const height = HEIGHT - PADDING_BOTTOM - y
          return (
            <g key={h.sprintId}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={height}
                rx={2}
                className="fill-indigo-500/80"
              >
                <title>{`${h.sprintName} · ${h.completedSp} SP`}</title>
              </rect>
              <text
                x={x + barWidth / 2}
                y={HEIGHT - PADDING_BOTTOM + 14}
                textAnchor="middle"
                fontSize="9"
                fill="currentColor"
                opacity="0.7"
              >
                {h.sprintName.length > 10
                  ? `${h.sprintName.slice(0, 9)}…`
                  : h.sprintName}
              </text>
              <text
                x={x + barWidth / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                opacity="0.85"
              >
                {h.completedSp}
              </text>
            </g>
          )
        })}

        {/* Banda forecast siguiente sprint */}
        {nextSprintForecast && (
          <>
            {(() => {
              const idx = history.length
              const x = PADDING_X + idx * slotWidth + (slotWidth - barWidth) / 2
              const yP10 = yFor(nextSprintForecast.p10)
              const yP90 = yFor(nextSprintForecast.p90)
              const yP50 = yFor(nextSprintForecast.p50)
              return (
                <g>
                  {/* Caja P10-P90 */}
                  <rect
                    x={x}
                    y={yP90}
                    width={barWidth}
                    height={Math.max(yP10 - yP90, 2)}
                    className="fill-emerald-500/30 stroke-emerald-400"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    rx={2}
                  >
                    <title>{`Forecast siguiente · P10 ${nextSprintForecast.p10} · P90 ${nextSprintForecast.p90}`}</title>
                  </rect>
                  {/* Línea P50 */}
                  <line
                    x1={x}
                    x2={x + barWidth}
                    y1={yP50}
                    y2={yP50}
                    className="stroke-emerald-300"
                    strokeWidth={2}
                  />
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT - PADDING_BOTTOM + 14}
                    textAnchor="middle"
                    fontSize="9"
                    fill="currentColor"
                    opacity="0.7"
                  >
                    Forecast
                  </text>
                  <text
                    x={x + barWidth / 2}
                    y={yP50 - 4}
                    textAnchor="middle"
                    fontSize="10"
                    className="fill-emerald-300"
                  >
                    {nextSprintForecast.p50}
                  </text>
                </g>
              )
            })()}
          </>
        )}
      </svg>

      {!nextSprintForecast && history.length > 0 && (
        <p className="mt-2 text-[10px] italic text-muted-foreground">
          Se requieren ≥3 sprints cerrados para forecast Monte Carlo.
        </p>
      )}
    </div>
  )
}
