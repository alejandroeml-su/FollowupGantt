'use client'

import { useMemo } from 'react'
import { clsx } from 'clsx'
import type { MonthlyPoint } from '@/lib/scheduling/baseline-trend'
import { formatMonthLabel } from '@/lib/scheduling/baseline-trend'

/**
 * HU-3.4 · Gráfico SV/SPI con SVG nativo (sin recharts).
 *
 * Diseño:
 *  - Eje X: meses (uniforme, espaciado por slot ancho).
 *  - Eje Y izquierdo: SV en valor monetario (escala dinámica).
 *  - Eje Y derecho: SPI ratio (0.0 – 2.0 fija para legibilidad).
 *  - Línea SV con color condicional por punto (success/warning/danger).
 *  - Línea SPI dashed con color primary; referencia horizontal en 1.0.
 *  - Puntos `<circle>` con `<title>` para tooltip nativo del navegador.
 *
 * A11y:
 *  - role="img" con aria-label resumen del periodo.
 *  - <title> y <desc> dentro del SVG (announced por SR).
 *  - La tabla complementaria (rendered por el panel) cubre 1.1.1
 *    (representación textual equivalente).
 *
 * Tamaños fijos: 320 x 160 — encajan en el panel de 360px de ancho.
 */

const WIDTH = 320
const HEIGHT = 160
const PADDING = { top: 12, right: 28, bottom: 28, left: 36 }
const SPI_MIN = 0
const SPI_MAX = 2

type Props = {
  points: MonthlyPoint[]
  className?: string
}

function classifyPointTone(spi: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (spi == null || !isFinite(spi)) return 'neutral'
  if (spi >= 1) return 'success'
  if (spi >= 0.9) return 'warning'
  return 'danger'
}

function toneColor(tone: 'success' | 'warning' | 'danger' | 'neutral'): string {
  switch (tone) {
    case 'success':
      return '#10b981' // emerald-500
    case 'warning':
      return '#f59e0b' // amber-500
    case 'danger':
      return '#ef4444' // red-500
    case 'neutral':
    default:
      return '#9ca3af' // gray-400
  }
}

export function BaselineTrendChart({ points, className }: Props) {
  const innerW = WIDTH - PADDING.left - PADDING.right
  const innerH = HEIGHT - PADDING.top - PADDING.bottom

  const computed = useMemo(() => {
    if (points.length === 0) {
      return { svScale: 1, slotW: innerW, svRange: { min: 0, max: 0 } }
    }
    const svValues = points.map((p) => p.sv)
    const rawMin = Math.min(0, ...svValues)
    const rawMax = Math.max(0, ...svValues)
    // Pad de 10% para que líneas no toquen el borde.
    const span = Math.max(1, rawMax - rawMin)
    const min = rawMin - span * 0.1
    const max = rawMax + span * 0.1
    const svScale = innerH / Math.max(1, max - min)
    const slotW = points.length > 1 ? innerW / (points.length - 1) : innerW
    return { svScale, slotW, svRange: { min, max } }
  }, [points, innerW, innerH])

  const xFor = (i: number) => PADDING.left + i * computed.slotW
  const ySvFor = (sv: number) =>
    PADDING.top + innerH - (sv - computed.svRange.min) * computed.svScale
  const ySpiFor = (spi: number) =>
    PADDING.top + innerH - ((spi - SPI_MIN) / (SPI_MAX - SPI_MIN)) * innerH

  // Path strings.
  const svPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${ySvFor(p.sv)}`)
    .join(' ')
  const spiPath = points
    .filter((p) => p.spi != null)
    .map((p, i) => {
      const idx = points.indexOf(p)
      return `${i === 0 ? 'M' : 'L'}${xFor(idx)},${ySpiFor(p.spi as number)}`
    })
    .join(' ')

  const ariaSummary =
    points.length === 0
      ? 'Sin datos de evolución SV/SPI'
      : `Gráfico de evolución SV/SPI desde ${formatMonthLabel(points[0].month)} a ${formatMonthLabel(
          points[points.length - 1].month,
        )}`

  if (points.length === 0) {
    return (
      <div
        className={clsx('flex h-[160px] items-center justify-center text-xs text-muted-foreground', className)}
      >
        Sin datos suficientes para graficar
      </div>
    )
  }

  // Línea de referencia SPI = 1.0 (en plan).
  const ySpiOne = ySpiFor(1)

  return (
    <svg
      role="img"
      aria-label={ariaSummary}
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={clsx('block', className)}
    >
      <title>{ariaSummary}</title>
      <desc>
        Línea sólida: variación de cronograma (SV) con color por mes según SPI.
        Línea dashed: SPI con eje derecho 0 a 2; referencia horizontal en SPI = 1.
      </desc>

      {/* Marco básico (eje X y Y izquierdo) */}
      <line
        x1={PADDING.left}
        y1={PADDING.top}
        x2={PADDING.left}
        y2={PADDING.top + innerH}
        stroke="currentColor"
        strokeOpacity={0.2}
      />
      <line
        x1={PADDING.left}
        y1={PADDING.top + innerH}
        x2={WIDTH - PADDING.right}
        y2={PADDING.top + innerH}
        stroke="currentColor"
        strokeOpacity={0.2}
      />

      {/* Línea de referencia SPI = 1.0 */}
      <line
        x1={PADDING.left}
        y1={ySpiOne}
        x2={WIDTH - PADDING.right}
        y2={ySpiOne}
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeDasharray="2 3"
      />

      {/* Línea SV (cronograma) */}
      <path
        d={svPath}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.6}
        strokeWidth={1.5}
      />

      {/* Línea SPI (índice) — dashed, color primary */}
      <path
        d={spiPath}
        fill="none"
        stroke="var(--primary, #6366f1)"
        strokeWidth={1.25}
        strokeDasharray="4 3"
      />

      {/* Puntos SV con tone por SPI */}
      {points.map((p, i) => {
        const tone = classifyPointTone(p.spi)
        const cx = xFor(i)
        const cy = ySvFor(p.sv)
        const tooltip =
          `${formatMonthLabel(p.month)} · ` +
          `PV ${Math.round(p.pv)} · EV ${Math.round(p.ev)} · ` +
          `SV ${Math.round(p.sv)} · SPI ${p.spi != null ? p.spi.toFixed(2) : '—'}`
        return (
          <g key={p.monthKey}>
            <circle cx={cx} cy={cy} r={3.5} fill={toneColor(tone)}>
              <title>{tooltip}</title>
            </circle>
            {/* Punto SPI también, más pequeño */}
            {p.spi != null && (
              <circle
                cx={cx}
                cy={ySpiFor(p.spi)}
                r={2}
                fill="var(--primary, #6366f1)"
                opacity={0.7}
              >
                <title>{tooltip}</title>
              </circle>
            )}
          </g>
        )
      })}

      {/* Etiquetas eje X (primer y último mes) */}
      <text
        x={PADDING.left}
        y={HEIGHT - 6}
        fontSize={10}
        textAnchor="start"
        fill="currentColor"
        opacity={0.6}
      >
        {formatMonthLabel(points[0].month)}
      </text>
      {points.length > 1 && (
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 6}
          fontSize={10}
          textAnchor="end"
          fill="currentColor"
          opacity={0.6}
        >
          {formatMonthLabel(points[points.length - 1].month)}
        </text>
      )}

      {/* Etiquetas eje Y derecho (SPI 0 / 1 / 2) */}
      <text
        x={WIDTH - PADDING.right + 4}
        y={ySpiFor(SPI_MAX) + 3}
        fontSize={9}
        textAnchor="start"
        fill="currentColor"
        opacity={0.5}
      >
        2.0
      </text>
      <text
        x={WIDTH - PADDING.right + 4}
        y={ySpiOne + 3}
        fontSize={9}
        textAnchor="start"
        fill="currentColor"
        opacity={0.5}
      >
        1.0
      </text>
      <text
        x={WIDTH - PADDING.right + 4}
        y={ySpiFor(SPI_MIN) + 3}
        fontSize={9}
        textAnchor="start"
        fill="currentColor"
        opacity={0.5}
      >
        0.0
      </text>
    </svg>
  )
}
