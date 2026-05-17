'use client'

/**
 * US-9.2 · Wave R5 — Radar chart AS-IS vs TO-BE en SVG puro.
 *
 * Decisión: SVG nativo en lugar de recharts/visx para no inflar el
 * bundle. El radar muestra ejes para cada dimensión (con valores
 * comparables) y dos polígonos superpuestos: AS-IS y TO-BE.
 *
 * Normalización: cada dimensión se normaliza al MAX entre AS-IS y
 * TO-BE para que el radar sea visualmente comparable incluso cuando
 * las dimensiones tienen unidades distintas (% vs pts vs días).
 */

import { useMemo } from 'react'
import type { SerializedGapDimension } from '@/lib/gap-analysis/types'

type Props = {
  dimensions: SerializedGapDimension[]
}

const SIZE = 280
const CX = SIZE / 2
const CY = SIZE / 2
const RADIUS = 110
const LABEL_RADIUS = RADIUS + 16
const RINGS = 4

function pointForAngle(angle: number, distance: number): [number, number] {
  return [CX + distance * Math.cos(angle), CY + distance * Math.sin(angle)]
}

export default function GapRadarChart({ dimensions }: Props) {
  // Sólo dimensiones con ambos valores definidos son útiles para el radar.
  const usable = useMemo(
    () => dimensions.filter((d) => d.asIsValue != null && d.toBeValue != null),
    [dimensions],
  )

  if (usable.length < 3) {
    return (
      <p className="text-xs text-muted-foreground">
        Se requieren al menos 3 dimensiones con AS-IS y TO-BE definidos
        para renderizar el radar. Actualmente hay {usable.length}.
      </p>
    )
  }

  const step = (2 * Math.PI) / usable.length
  // Punto de inicio: -90° (apex arriba).
  const start = -Math.PI / 2

  const asIsPath: string[] = []
  const toBePath: string[] = []
  const axes: Array<{
    x1: number
    y1: number
    x2: number
    y2: number
    label: string
    labelX: number
    labelY: number
  }> = []

  usable.forEach((d, i) => {
    const angle = start + i * step
    const max = Math.max(d.asIsValue ?? 0, d.toBeValue ?? 0, 1)
    const asIsRatio = Math.max(0, Math.min(1, (d.asIsValue ?? 0) / max))
    const toBeRatio = Math.max(0, Math.min(1, (d.toBeValue ?? 0) / max))

    const [ax, ay] = pointForAngle(angle, asIsRatio * RADIUS)
    const [tx, ty] = pointForAngle(angle, toBeRatio * RADIUS)
    asIsPath.push(`${i === 0 ? 'M' : 'L'}${ax.toFixed(1)},${ay.toFixed(1)}`)
    toBePath.push(`${i === 0 ? 'M' : 'L'}${tx.toFixed(1)},${ty.toFixed(1)}`)

    const [ex, ey] = pointForAngle(angle, RADIUS)
    const [lx, ly] = pointForAngle(angle, LABEL_RADIUS)
    axes.push({
      x1: CX,
      y1: CY,
      x2: ex,
      y2: ey,
      label: d.name,
      labelX: lx,
      labelY: ly,
    })
  })
  asIsPath.push('Z')
  toBePath.push('Z')

  const rings: number[] = []
  for (let r = 1; r <= RINGS; r++) {
    rings.push((r / RINGS) * RADIUS)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Radar AS-IS vs TO-BE"
        className="h-auto w-full max-w-[320px]"
      >
        {/* Anillos */}
        {rings.map((r, i) => (
          <circle
            key={i}
            cx={CX}
            cy={CY}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={i === RINGS - 1 ? 0.4 : 0.15}
            className="text-muted-foreground"
          />
        ))}
        {/* Ejes + labels */}
        {axes.map((a, i) => (
          <g key={i}>
            <line
              x1={a.x1}
              y1={a.y1}
              x2={a.x2}
              y2={a.y2}
              stroke="currentColor"
              strokeOpacity={0.2}
              className="text-muted-foreground"
            />
            <text
              x={a.labelX}
              y={a.labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-current text-[9px]"
            >
              {a.label.length > 14 ? a.label.slice(0, 13) + '…' : a.label}
            </text>
          </g>
        ))}
        {/* TO-BE (debajo, más opaco) */}
        <path
          d={toBePath.join(' ')}
          fill="rgba(59,130,246,0.18)"
          stroke="rgb(59,130,246)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        {/* AS-IS (encima) */}
        <path
          d={asIsPath.join(' ')}
          fill="rgba(16,185,129,0.25)"
          stroke="rgb(16,185,129)"
          strokeWidth={1.5}
        />
      </svg>
      <div className="flex gap-3 text-[10px]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" />
          AS-IS
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm border border-blue-500"
            style={{ borderStyle: 'dashed' }}
          />
          TO-BE
        </span>
      </div>
    </div>
  )
}
