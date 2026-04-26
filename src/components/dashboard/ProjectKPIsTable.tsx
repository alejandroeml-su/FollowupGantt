'use client'

import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { clsx } from 'clsx'
import type { ProjectKPIRow } from '@/lib/actions/kpis'

type Props = {
  rows: ProjectKPIRow[]
}

const STATUS_LABEL: Record<ProjectKPIRow['status'], string> = {
  PLANNING: 'Planificación',
  ACTIVE: 'Activo',
  ON_HOLD: 'En pausa',
  COMPLETED: 'Completado',
}

const STATUS_TONE: Record<ProjectKPIRow['status'], string> = {
  PLANNING: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  ACTIVE: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
  ON_HOLD: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
}

const HEALTH_LABEL: Record<ProjectKPIRow['health'], string> = {
  HEALTHY: 'Saludable',
  AT_RISK: 'En riesgo',
  CRITICAL: 'Crítico',
}

const HEALTH_TONE: Record<ProjectKPIRow['health'], string> = {
  HEALTHY: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  AT_RISK: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  CRITICAL: 'bg-red-500/15 text-red-300 border-red-500/40',
}

function formatIndex(value: number | null): string {
  if (value == null || !isFinite(value)) return '—'
  return value.toFixed(2)
}

function formatPercent(value: number | null, digits = 1): string {
  if (value == null || !isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

function indexTrendIcon(value: number | null) {
  if (value == null || !isFinite(value)) return <Minus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
  if (value >= 1) return <ArrowUp className="h-3 w-3 text-emerald-400" aria-hidden="true" />
  return <ArrowDown className="h-3 w-3 text-red-400" aria-hidden="true" />
}

function overdueTone(count: number, criticalCount: number): string {
  if (count === 0) return 'text-muted-foreground'
  if (criticalCount >= 3 || count >= 5) return 'text-red-300 font-semibold'
  return 'text-amber-300 font-semibold'
}

export function ProjectKPIsTable({ rows }: Props) {
  const router = useRouter()

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Sin proyectos que cumplan los filtros.
        </p>
      </div>
    )
  }

  // TODO: añadir sort por columna en próxima iteración.

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            KPIs por proyecto: avance, tareas, atrasadas, críticas, SPI, CPI, ROI y salud.
          </caption>
          <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                Proyecto
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                Avance
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Tareas
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Atrasadas
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                Críticas abiertas
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                SPI
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                CPI
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                ROI
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                Salud
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const onOpen = () => router.push(`/projects/${row.projectId}`)
              return (
                <tr
                  key={row.projectId}
                  tabIndex={0}
                  role="link"
                  aria-label={`Abrir proyecto ${row.projectName}`}
                  onClick={onOpen}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpen()
                    }
                  }}
                  className="cursor-pointer transition-colors hover:bg-secondary/40 focus:bg-secondary/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                >
                  {/* Proyecto */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-foreground">{row.projectName}</span>
                      <span
                        className={clsx(
                          'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                          STATUS_TONE[row.status],
                        )}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </div>
                  </td>

                  {/* Avance */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, Math.max(0, row.avgProgress))}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {row.avgProgress.toFixed(0)}%
                      </span>
                    </div>
                  </td>

                  {/* Tareas */}
                  <td className="px-4 py-3 text-right tabular-nums text-foreground/90">
                    {row.completedTasks} / {row.totalTasks}
                  </td>

                  {/* Atrasadas */}
                  <td
                    className={clsx(
                      'px-4 py-3 text-right tabular-nums',
                      overdueTone(row.overdueTasks, row.criticalOpenTasks),
                    )}
                  >
                    {row.overdueTasks}
                  </td>

                  {/* Críticas abiertas */}
                  <td
                    className={clsx(
                      'px-4 py-3 text-right tabular-nums',
                      row.criticalOpenTasks > 0 ? 'text-red-300 font-semibold' : 'text-muted-foreground',
                    )}
                  >
                    {row.criticalOpenTasks}
                  </td>

                  {/* SPI */}
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1 tabular-nums text-foreground/90">
                      {indexTrendIcon(row.spi)}
                      {formatIndex(row.spi)}
                    </span>
                  </td>

                  {/* CPI */}
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1 tabular-nums text-foreground/90">
                      {indexTrendIcon(row.cpi)}
                      {formatIndex(row.cpi)}
                    </span>
                  </td>

                  {/* ROI */}
                  <td
                    className={clsx(
                      'px-4 py-3 text-right tabular-nums',
                      row.roi == null
                        ? 'text-muted-foreground'
                        : row.roi >= 0
                          ? 'text-emerald-300'
                          : 'text-red-300',
                    )}
                  >
                    {formatPercent(row.roi)}
                  </td>

                  {/* Salud */}
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
                        HEALTH_TONE[row.health],
                      )}
                    >
                      {HEALTH_LABEL[row.health]}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
