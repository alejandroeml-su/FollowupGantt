/**
 * Equipo D3 · EVMSnapshotCard — agregados de portafolio (CV/SV/CPI/SPI).
 *
 * Server component. Consume `PortfolioReport.summary` y los rows para
 * sumar CV/SV cross-project y mostrar avg SPI/CPI.
 *
 * Limitación conocida: el sparkline temporal pedido en la spec requiere
 * snapshots EVM por día — no disponibles aún. Se reemplaza por una
 * mini-leyenda con los valores agregados. TODO: cuando exista
 * `EvmDailySnapshot` se reemplaza por gráfico real (ver
 * `BaselineTrendChart` para referencia).
 */

import type { PortfolioReport } from '@/lib/reports/portfolio'

type Props = {
  report: PortfolioReport
}

function fmt(v: number | null, suffix = ''): string {
  if (v == null) return '—'
  if (Math.abs(v) >= 1000) return `${Math.round(v).toLocaleString('es-MX')}${suffix}`
  return `${v.toFixed(2)}${suffix}`
}

export function EVMSnapshotCard({ report }: Props) {
  let totalCV = 0
  let totalSV = 0
  let cvCount = 0
  let svCount = 0
  for (const row of report.rows) {
    if (row.cv != null) {
      totalCV += row.cv
      cvCount += 1
    }
    if (row.evm?.sv != null) {
      totalSV += row.evm.sv
      svCount += 1
    }
  }

  const metrics = [
    {
      key: 'cv',
      label: 'CV agregado',
      value: cvCount > 0 ? fmt(totalCV) : '—',
      hint: cvCount > 0 ? `${cvCount} proyecto${cvCount === 1 ? '' : 's'}` : 'Sin datos',
      tone: cvCount > 0 && totalCV >= 0 ? 'pos' : cvCount > 0 ? 'neg' : 'neutral',
    },
    {
      key: 'sv',
      label: 'SV agregado',
      value: svCount > 0 ? fmt(totalSV) : '—',
      hint: svCount > 0 ? `${svCount} proyecto${svCount === 1 ? '' : 's'}` : 'Sin datos',
      tone: svCount > 0 && totalSV >= 0 ? 'pos' : svCount > 0 ? 'neg' : 'neutral',
    },
    {
      key: 'cpi',
      label: 'CPI promedio',
      value: fmt(report.summary.avgCPI),
      hint: report.summary.avgCPI != null && report.summary.avgCPI >= 1 ? 'Eficiente' : 'Vigilar',
      tone:
        report.summary.avgCPI == null
          ? 'neutral'
          : report.summary.avgCPI >= 1
            ? 'pos'
            : 'neg',
    },
    {
      key: 'spi',
      label: 'SPI promedio',
      value: fmt(report.summary.avgSPI),
      hint: report.summary.avgSPI != null && report.summary.avgSPI >= 1 ? 'A tiempo' : 'Retrasado',
      tone:
        report.summary.avgSPI == null
          ? 'neutral'
          : report.summary.avgSPI >= 1
            ? 'pos'
            : 'neg',
    },
  ] as const

  const TONE_CLASS = {
    pos: 'text-emerald-500',
    neg: 'text-red-500',
    neutral: 'text-muted-foreground',
  } as const

  return (
    <section
      data-testid="evm-snapshot-card"
      className="rounded-2xl bg-card border border-border p-6 space-y-4"
    >
      <header>
        <h2 className="text-lg font-bold text-foreground">EVM del portafolio</h2>
        <p className="text-xs text-muted-foreground">
          Indicadores agregados — actualizado al{' '}
          {new Date(report.generatedAt).toLocaleDateString('es-MX')}
        </p>
      </header>
      <dl className="grid grid-cols-2 gap-3">
        {metrics.map((m) => (
          <div
            key={m.key}
            data-testid={`evm-metric-${m.key}`}
            className="rounded-lg border border-border/60 bg-background/40 p-3"
          >
            <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {m.label}
            </dt>
            <dd className={`mt-1 text-2xl font-black ${TONE_CLASS[m.tone]}`}>
              {m.value}
            </dd>
            <p className="text-[11px] text-muted-foreground">{m.hint}</p>
          </div>
        ))}
      </dl>
      {/* TODO(P1.5): reemplazar por sparkline real cuando exista EvmDailySnapshot. */}
    </section>
  )
}
