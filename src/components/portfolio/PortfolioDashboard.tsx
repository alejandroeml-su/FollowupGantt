'use client'

/**
 * Wave P10 (HU-10.1 · ALPHA-1.3+1.4) — Portfolio Dashboard MVP.
 *
 * Compone:
 *  - Banda de KPIs globales (totales, distribución de health, avg CPI/SPI)
 *  - HealthHeatmap (matriz visual rápida de estado por proyecto)
 *  - Grid de cards detallado con drill-down a /projects/{id}
 *
 * Filtros avanzados (area/manager) y export PDF/Excel quedan deferred a
 * R2 follow-up (ALPHA-1.5/1.6, 3 SP).
 */

import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Flame,
  Rocket,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import type {
  PortfolioOverview,
  PortfolioProjectSummary,
  ProjectHealthStatus,
} from '@/lib/portfolio/types'
import { HEALTH_COLOR, HEALTH_LABEL } from '@/lib/portfolio/health'
import { HealthHeatmap } from './HealthHeatmap'

type Props = {
  overview: PortfolioOverview
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatNumber(n: number | null, decimals = 2): string {
  if (n == null) return '—'
  return n.toFixed(decimals)
}

function renderHealthIcon(h: ProjectHealthStatus, className: string) {
  switch (h) {
    case 'ON_TRACK':
      return <CheckCircle2 className={className} />
    case 'AT_RISK':
      return <AlertTriangle className={className} />
    case 'DELAYED':
      return <Clock className={className} />
    case 'BLOCKED':
      return <Flame className={className} />
  }
}

function ProjectCard({ project }: { project: PortfolioProjectSummary }) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-indigo-500/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-indigo-300">
            {project.name}
          </h3>
          {project.areaName && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {project.areaName}
              {project.managerName && ` · ${project.managerName}`}
            </p>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${HEALTH_COLOR[project.health]}`}
        >
          {renderHealthIcon(project.health, 'h-3 w-3')}
          {HEALTH_LABEL[project.health]}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Avance</span>
          <span className="font-semibold text-foreground">
            {project.progress}%
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-input">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="flex items-center gap-1 text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          CPI <span className="font-semibold text-foreground">
            {formatNumber(project.cpi)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <TrendingDown className="h-3 w-3" />
          SPI <span className="font-semibold text-foreground">
            {formatNumber(project.spi)}
          </span>
        </div>
        <div className="text-muted-foreground">
          Tareas activas{' '}
          <span className="font-semibold text-foreground">
            {project.activeTasks}/{project.totalTasks}
          </span>
        </div>
        <div className="text-muted-foreground">
          Riesgos{' '}
          <span className="font-semibold text-rose-300">
            {project.riskCount.high}
          </span>
          <span className="text-muted-foreground/60"> H · </span>
          <span className="font-semibold text-amber-300">
            {project.riskCount.medium}
          </span>
          <span className="text-muted-foreground/60"> M</span>
        </div>
      </div>

      <div className="mt-3 space-y-1 border-t border-border/60 pt-2 text-[11px]">
        {project.nextRelease ? (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Rocket className="h-3 w-3" /> Próxima release
            </span>
            <span className="truncate font-medium text-foreground">
              {project.nextRelease.name}
              {project.nextRelease.targetDate && (
                <span className="ml-1 text-muted-foreground">
                  · {formatDateShort(project.nextRelease.targetDate)}
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="text-[10px] italic text-muted-foreground/70">
            Sin release planeada
          </div>
        )}

        {project.currentSprint ? (
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Target className="h-3 w-3" /> Sprint actual
            </span>
            <span className="truncate font-medium text-foreground">
              {project.currentSprint.name}
              {project.currentSprint.endDate && (
                <span className="ml-1 text-muted-foreground">
                  · cierra {formatDateShort(project.currentSprint.endDate)}
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="text-[10px] italic text-muted-foreground/70">
            Sin sprint activo
          </div>
        )}
      </div>
    </Link>
  )
}

export function PortfolioDashboard({ overview }: Props) {
  const { totals, projects } = overview

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* ── KPIs globales ── */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Proyectos
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {totals.projects}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tareas activas
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {totals.activeTasks}
          </p>
          <p className="text-[10px] text-muted-foreground">
            de {totals.totalTasks} totales
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            CPI promedio
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {formatNumber(totals.avgCpi)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            SPI promedio
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {formatNumber(totals.avgSpi)}
          </p>
        </div>
      </section>

      {/* ── Distribución health ── */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            { key: 'ON_TRACK', count: totals.onTrack },
            { key: 'AT_RISK', count: totals.atRisk },
            { key: 'DELAYED', count: totals.delayed },
            { key: 'BLOCKED', count: totals.blocked },
          ] as const
        ).map((b) => (
          <div
            key={b.key}
            className={`rounded-lg border p-3 ${HEALTH_COLOR[b.key]}`}
          >
            {renderHealthIcon(b.key, 'h-4 w-4')}
            <p className="mt-1 text-2xl font-bold">{b.count}</p>
            <p className="text-[10px] uppercase tracking-wider">
              {HEALTH_LABEL[b.key]}
            </p>
          </div>
        ))}
      </section>

      {/* ── Heatmap salud ── */}
      <HealthHeatmap projects={projects} />

      {/* ── Grid de cards ── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Detalle por proyecto
        </h2>
        {projects.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Sin proyectos que coincidan con los filtros aplicados.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
