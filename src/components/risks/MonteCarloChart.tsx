'use client'

/**
 * Wave P8 · Equipo P8-2 — Histograma de duraciones simuladas Monte Carlo.
 *
 * Renderiza:
 *   - Resumen: baseline, P50, P80, P95, mean, stdDev.
 *   - Histograma SVG simple (sin librerías): cada bin es un rect, el max
 *     count define la altura relativa.
 *   - Líneas verticales para P50/P80/P95 con label.
 *
 * Decisiones:
 *   - SVG inline: evitamos chart.js / recharts. La forma del histograma es
 *     simple y la página `/risks` no necesita interactividad rica.
 *   - `binWidth` autoescalable: Math.max(1, ceil((max-min)/30)) para que
 *     siempre veamos ≤ 30 barras independiente del rango.
 */

import { useMemo } from 'react'
import { histogram, type MonteCarloResult } from '@/lib/risks/monte-carlo'

type Props = {
  result: MonteCarloResult | null
  loading?: boolean
}

const SVG_W = 600
const SVG_H = 200
const PAD = 28

export function MonteCarloChart({ result, loading }: Props) {
  const bins = useMemo(() => {
    if (!result || result.samples.length === 0) return []
    const range = Math.max(...result.samples) - Math.min(...result.samples)
    const binWidth = Math.max(1, Math.ceil(range / 30))
    return histogram(result.samples, binWidth)
  }, [result])

  if (loading) {
    return (
      <div
        className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
        data-testid="mc-chart-loading"
      >
        Corriendo simulación…
      </div>
    )
  }

  if (!result) {
    return (
      <div
        className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
        data-testid="mc-chart-empty"
      >
        Aún no se ha ejecutado la simulación.
      </div>
    )
  }

  if (result.samples.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        El proyecto no tiene tareas para simular.
      </div>
    )
  }

  const maxCount = Math.max(...bins.map((b) => b.count), 1)
  const minX = bins[0]?.binStart ?? 0
  const maxX = bins[bins.length - 1]?.binEnd ?? 1
  const xRange = Math.max(1, maxX - minX)

  function xScale(v: number): number {
    return PAD + ((v - minX) / xRange) * (SVG_W - 2 * PAD)
  }

  function yScale(count: number): number {
    return SVG_H - PAD - (count / maxCount) * (SVG_H - 2 * PAD)
  }

  return (
    <div
      className="rounded-lg border border-border bg-card p-3"
      data-testid="mc-chart"
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Simulación Monte Carlo · {result.iterations} iteraciones
        </h3>
        <span className="text-[11px] text-muted-foreground">
          Baseline (CPM): <strong>{result.baseline}</strong> días
        </span>
      </header>

      {/* Stats grid */}
      <dl
        className="mb-3 grid grid-cols-5 gap-2 text-xs"
        data-testid="mc-stats"
      >
        <Stat label="P50" value={`${result.P50}d`} testid="mc-p50" />
        <Stat label="P80" value={`${result.P80}d`} testid="mc-p80" />
        <Stat label="P95" value={`${result.P95}d`} testid="mc-p95" />
        <Stat label="Media" value={`${result.mean.toFixed(1)}d`} />
        <Stat label="σ" value={`${result.stdDev.toFixed(2)}d`} />
      </dl>

      {/* Histogram */}
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="h-48 w-full"
        role="img"
        aria-label="Distribución Monte Carlo de duración del proyecto"
      >
        {/* Eje X */}
        <line
          x1={PAD}
          y1={SVG_H - PAD}
          x2={SVG_W - PAD}
          y2={SVG_H - PAD}
          className="stroke-border"
        />

        {/* Barras */}
        {bins.map((b) => {
          const x = xScale(b.binStart)
          const w = Math.max(1, xScale(b.binEnd) - x - 1)
          const y = yScale(b.count)
          const h = SVG_H - PAD - y
          return (
            <rect
              key={`bin-${b.binStart}`}
              x={x}
              y={y}
              width={w}
              height={h}
              className="fill-primary/40"
            />
          )
        })}

        {/* Percentile guides */}
        {[
          { value: result.P50, label: 'P50', color: 'stroke-emerald-500' },
          { value: result.P80, label: 'P80', color: 'stroke-amber-500' },
          { value: result.P95, label: 'P95', color: 'stroke-red-500' },
        ].map((g) => (
          <g key={g.label}>
            <line
              x1={xScale(g.value)}
              y1={PAD / 2}
              x2={xScale(g.value)}
              y2={SVG_H - PAD}
              className={`${g.color} stroke-2`}
              strokeDasharray="4 3"
            />
            <text
              x={xScale(g.value) + 3}
              y={PAD / 2 + 8}
              className="fill-foreground text-[10px]"
            >
              {g.label} = {g.value}d
            </text>
          </g>
        ))}

        {/* X axis ticks */}
        <text
          x={PAD}
          y={SVG_H - PAD / 3}
          className="fill-muted-foreground text-[10px]"
        >
          {minX}d
        </text>
        <text
          x={SVG_W - PAD}
          y={SVG_H - PAD / 3}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {maxX}d
        </text>
      </svg>
    </div>
  )
}

function Stat({
  label,
  value,
  testid,
}: {
  label: string
  value: string
  testid?: string
}) {
  return (
    <div
      className="rounded border border-border bg-muted/30 px-2 py-1 text-center"
      data-testid={testid}
    >
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}
