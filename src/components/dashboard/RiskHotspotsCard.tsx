/**
 * Equipo D3 · RiskHotspotsCard — top tareas con DELAY_RISK alto.
 *
 * Server component. Consume `RiskOverviewItem[]` de
 * `getProjectRiskOverview` y muestra los 5 con mayor `score`. Click en
 * la fila navega al proyecto con la tarea preseleccionada (query param
 * `task=<id>`) — la convención existente del repo (TaskDrawer lee el
 * search-param en `ListBoardClient`).
 */

import Link from 'next/link'
import type { RiskOverviewItem } from '@/lib/actions/insights'

type Props = {
  items: RiskOverviewItem[]
  limit?: number
}

const LEVEL_DOT: Record<RiskOverviewItem['level'], string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
}

const LEVEL_LABEL: Record<RiskOverviewItem['level'], string> = {
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
}

export function RiskHotspotsCard({ items, limit = 5 }: Props) {
  const top = items.slice(0, limit)
  return (
    <section
      data-testid="risk-hotspots-card"
      className="rounded-2xl bg-card border border-border p-6 space-y-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-foreground">Riesgos calientes</h2>
          <p className="text-xs text-muted-foreground">
            Tareas con mayor probabilidad de retraso
          </p>
        </div>
        <Link
          href="/insights"
          className="text-xs font-semibold text-primary hover:underline"
        >
          Ver insights →
        </Link>
      </header>

      <ul className="space-y-3">
        {top.length === 0 && (
          <li className="text-sm text-muted-foreground">
            Sin riesgos detectados. Buen trabajo.
          </li>
        )}
        {top.map((r) => (
          <li
            key={r.taskId}
            className="flex items-start gap-3"
            data-testid={`risk-hotspot-${r.taskId}`}
          >
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${LEVEL_DOT[r.level]}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <Link
                href={`/list?project=${r.projectId}&task=${r.taskId}`}
                className="block truncate text-sm font-medium text-foreground hover:underline"
              >
                {r.taskTitle}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {r.projectName} · {LEVEL_LABEL[r.level]} ·{' '}
                {Math.round(r.score * 100)}%
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
