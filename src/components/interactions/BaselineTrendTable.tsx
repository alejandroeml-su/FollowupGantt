'use client'

import { clsx } from 'clsx'
import {
  formatMonthLabel,
  takeLastN,
  type MonthlyPoint,
} from '@/lib/scheduling/baseline-trend'

/**
 * HU-3.4 · Tabla complementaria de los últimos 6 meses.
 *
 * Cumple WCAG 1.1.1 (texto equivalente al gráfico SVG). Resaltamos la
 * fila del mes actual con `aria-current="date"` para anuncio del lector
 * de pantalla.
 *
 * Formato compacto (text-[11px], padding mínimo) — el panel mide 360px.
 */

type Props = {
  points: readonly MonthlyPoint[]
  className?: string
}

function fmtNumber(n: number | null): string {
  if (n == null || !isFinite(n)) return '—'
  // Sin sufijos K/M para mantener precisión en valores pequeños.
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtSpi(spi: number | null): string {
  if (spi == null || !isFinite(spi)) return '—'
  return spi.toFixed(2)
}

export function BaselineTrendTable({ points, className }: Props) {
  const last6 = takeLastN(points, 6)
  if (last6.length === 0) {
    return (
      <p className={clsx('px-3 py-4 text-center text-[11px] text-muted-foreground', className)}>
        Sin datos en el periodo.
      </p>
    )
  }

  const now = new Date()
  const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  return (
    <table className={clsx('w-full text-[11px]', className)}>
      <caption className="sr-only">
        Tabla con PV, EV, SV y SPI de los últimos {last6.length} meses
      </caption>
      <thead>
        <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          <th className="px-2 py-1 font-medium">Mes</th>
          <th className="px-2 py-1 text-right font-medium">PV</th>
          <th className="px-2 py-1 text-right font-medium">EV</th>
          <th className="px-2 py-1 text-right font-medium">SV</th>
          <th className="px-2 py-1 text-right font-medium">SPI</th>
        </tr>
      </thead>
      <tbody>
        {last6.map((p) => {
          const isCurrent = p.monthKey === currentKey
          const svColor =
            p.sv > 0
              ? 'text-emerald-400'
              : p.sv < 0
                ? 'text-red-400'
                : 'text-foreground/80'
          return (
            <tr
              key={p.monthKey}
              aria-current={isCurrent ? 'date' : undefined}
              className={clsx(
                'border-b border-border/40',
                isCurrent && 'bg-accent/40',
              )}
            >
              <td className="px-2 py-1 font-medium text-foreground/90">
                {formatMonthLabel(p.month)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                {fmtNumber(p.pv)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                {fmtNumber(p.ev)}
              </td>
              <td className={clsx('px-2 py-1 text-right tabular-nums', svColor)}>
                {fmtNumber(p.sv)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-foreground/80">
                {fmtSpi(p.spi)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
