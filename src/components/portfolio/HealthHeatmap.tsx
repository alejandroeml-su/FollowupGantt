'use client'

/**
 * Wave P10 (HU-10.1 · ALPHA-1.4) — Heatmap visual de salud de portfolio.
 *
 * Matriz compacta tipo "calor": una celda por proyecto, color según health.
 * Ordena por severity descendente (BLOCKED > DELAYED > AT_RISK > ON_TRACK)
 * para que el ojo capture los problemas primero.
 *
 * Tooltip nativo (title) por celda; drill-down click → /projects/{id}.
 */

import Link from 'next/link'
import { useMemo } from 'react'
import type {
  PortfolioProjectSummary,
  ProjectHealthStatus,
} from '@/lib/portfolio/types'
import { HEALTH_LABEL } from '@/lib/portfolio/health'

const HEALTH_BG: Record<ProjectHealthStatus, string> = {
  BLOCKED: 'bg-rose-500',
  DELAYED: 'bg-orange-500',
  AT_RISK: 'bg-amber-500',
  ON_TRACK: 'bg-emerald-500',
}

const HEALTH_RANK: Record<ProjectHealthStatus, number> = {
  BLOCKED: 0,
  DELAYED: 1,
  AT_RISK: 2,
  ON_TRACK: 3,
}

type Props = {
  projects: PortfolioProjectSummary[]
}

export function HealthHeatmap({ projects }: Props) {
  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      const rankDiff = HEALTH_RANK[a.health] - HEALTH_RANK[b.health]
      if (rankDiff !== 0) return rankDiff
      return a.name.localeCompare(b.name, 'es-MX')
    })
  }, [projects])

  if (sorted.length === 0) return null

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Heatmap de salud
        </h2>
        <p className="text-[10px] text-muted-foreground">
          Ordenado por severidad descendente
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {sorted.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            title={`${p.name} · ${HEALTH_LABEL[p.health]} · ${p.progress}% · CPI ${p.cpi ?? '—'} · SPI ${p.spi ?? '—'}`}
            aria-label={`${p.name} ${HEALTH_LABEL[p.health]}`}
            className={`group flex h-12 min-w-[120px] flex-1 flex-col justify-between overflow-hidden rounded-md ${HEALTH_BG[p.health]} px-2 py-1.5 text-[10px] font-medium text-white shadow-inner transition-transform hover:scale-[1.02]`}
          >
            <span className="line-clamp-1">{p.name}</span>
            <span className="opacity-90">{p.progress}%</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
