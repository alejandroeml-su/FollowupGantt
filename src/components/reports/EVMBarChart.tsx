/**
 * Ola P5 · Equipo P5-3.
 *
 * Gráfico de barras SVG inline (sin librerías) para visualizar PV / EV / AC.
 * Componente puro sin estado: se le pasa el resultado de `computeEVM`.
 */

import { formatMoney } from '@/lib/reports/evm'

export function EVMBarChart({
  pv,
  ev,
  ac,
}: {
  pv: number
  ev: number
  ac: number
}) {
  const max = Math.max(pv, ev, ac, 1)
  const bars = [
    { key: 'PV', label: 'Valor Planificado', value: pv, color: '#2563eb' },
    { key: 'EV', label: 'Valor Ganado', value: ev, color: '#059669' },
    { key: 'AC', label: 'Costo Real', value: ac, color: '#d97706' },
  ]

  // Coordenadas SVG: 480x180 con padding para etiquetas.
  const width = 480
  const height = 180
  const padTop = 20
  const padBottom = 30
  const padLeft = 60
  const padRight = 20
  const innerH = height - padTop - padBottom
  const innerW = width - padLeft - padRight
  const barWidth = innerW / bars.length - 16

  return (
    <svg
      role="img"
      aria-label="Comparación PV vs EV vs AC"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      {/* eje Y: 4 ticks (0, 33%, 66%, 100% del max) */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padTop + innerH - innerH * t
        return (
          <g key={t}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke="#e5e7eb"
              strokeDasharray={t === 0 ? '0' : '2 2'}
            />
            <text
              x={padLeft - 6}
              y={y + 3}
              fontSize="8"
              textAnchor="end"
              fill="#6b7280"
            >
              {formatMoney(max * t)}
            </text>
          </g>
        )
      })}

      {/* barras */}
      {bars.map((b, i) => {
        const h = (b.value / max) * innerH
        const x = padLeft + i * (innerW / bars.length) + 8
        const y = padTop + innerH - h
        return (
          <g key={b.key}>
            <rect x={x} y={y} width={barWidth} height={h} fill={b.color} rx={2} />
            <text
              x={x + barWidth / 2}
              y={y - 5}
              textAnchor="middle"
              fontSize="9"
              fill="#111827"
              fontWeight={600}
            >
              {formatMoney(b.value)}
            </text>
            <text
              x={x + barWidth / 2}
              y={height - padBottom + 14}
              textAnchor="middle"
              fontSize="10"
              fontWeight={700}
              fill="#111827"
            >
              {b.key}
            </text>
            <text
              x={x + barWidth / 2}
              y={height - padBottom + 26}
              textAnchor="middle"
              fontSize="8"
              fill="#4b5563"
            >
              {b.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
