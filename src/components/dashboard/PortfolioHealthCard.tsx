/**
 * Equipo D3 · PortfolioHealthCard — semáforo cross-project.
 *
 * Server component (renderiza datos pre-cargados). Recibe la lista de
 * proyectos del PortfolioReport y muestra:
 *   - Conteo por health (verde/amarillo/rojo/gris).
 *   - Lista compacta con link al detalle de cada proyecto.
 *
 * Decisión D3-PH-1: el "sparkline" pedido en la spec se muestra como
 * barra horizontal de health-breakdown. La serie temporal real
 * requeriría snapshots EVM por día (no disponibles en BD); marcamos
 * TODO para P1.5 cuando exista la tabla `BaselineSnapshot` extendida.
 */

import Link from 'next/link'
import type { PortfolioRow } from '@/lib/reports/portfolio'
import type { HealthStatus } from '@/lib/reports/evm'

type Props = {
  rows: PortfolioRow[]
  summary: {
    totalProjects: number
    healthBreakdown: Record<HealthStatus, number>
  }
}

const HEALTH_LABEL: Record<HealthStatus, string> = {
  green: 'Saludable',
  yellow: 'En margen',
  red: 'Crítico',
  gray: 'Sin datos',
}

const HEALTH_DOT: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
  gray: 'bg-muted-foreground/40',
}

const HEALTH_BAR: Record<HealthStatus, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
  gray: 'bg-muted',
}

export function PortfolioHealthCard({ rows, summary }: Props) {
  const total = Math.max(1, summary.totalProjects)
  const order: HealthStatus[] = ['green', 'yellow', 'red', 'gray']

  return (
    <section
      data-testid="portfolio-health-card"
      className="rounded-2xl bg-card border border-border p-6 space-y-5"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-foreground">Salud del portafolio</h2>
          <p className="text-xs text-muted-foreground">
            {summary.totalProjects} proyecto{summary.totalProjects === 1 ? '' : 's'} monitoreado{summary.totalProjects === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/reports/portfolio"
          className="text-xs font-semibold text-primary hover:underline"
        >
          Ver portafolio →
        </Link>
      </header>

      {/* Barra horizontal de proporción por health */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {order.map((h) => {
          const count = summary.healthBreakdown[h] ?? 0
          if (count === 0) return null
          const pct = (count / total) * 100
          return (
            <div
              key={h}
              className={HEALTH_BAR[h]}
              style={{ width: `${pct}%` }}
              data-testid={`portfolio-health-bar-${h}`}
              aria-label={`${HEALTH_LABEL[h]}: ${count}`}
            />
          )
        })}
      </div>

      <ul className="space-y-2">
        {rows.length === 0 && (
          <li className="text-sm text-muted-foreground">
            Aún no hay proyectos en el portafolio.
          </li>
        )}
        {rows.slice(0, 6).map((r) => (
          <li key={r.id} className="flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 rounded-full ${HEALTH_DOT[r.health]}`}
              aria-hidden
            />
            <Link
              href={`/projects/${r.id}`}
              className="flex-1 truncate text-sm font-medium text-foreground hover:underline"
              data-testid={`portfolio-project-link-${r.id}`}
            >
              {r.name}
            </Link>
            <span className="text-xs text-muted-foreground">
              {r.progressPercent}%
            </span>
            <span className="text-xs text-muted-foreground capitalize">
              {HEALTH_LABEL[r.health]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
