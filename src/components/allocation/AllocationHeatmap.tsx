'use client'

/**
 * Wave P10 (HU-10.7 · BETA-2.3) — Heatmap de allocation cross-project.
 *
 * Matriz usuarios (filas) × semanas (columnas). Color por % allocation
 * sobre capacity:
 *  - 0-50%   → emerald (sub-utilizado)
 *  - 50-80%  → sky (saludable)
 *  - 80-100% → amber (al límite)
 *  - >100%   → rose (over-allocated)
 *
 * Click en celda → modal/drawer con detalle de proyectos (TODO R2).
 */

import { useMemo, useTransition } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { refreshAllocationSnapshots } from '@/lib/actions/allocation'
import type { WeeklyAllocationSnapshot } from '@/lib/allocation/compute'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  snapshots: WeeklyAllocationSnapshot[]
}

function utilizationClass(percent: number): string {
  if (percent > 100) return 'bg-rose-500/40 text-rose-100 border-rose-500/60'
  if (percent >= 80) return 'bg-amber-500/30 text-amber-100 border-amber-500/50'
  if (percent >= 50) return 'bg-sky-500/25 text-sky-100 border-sky-500/40'
  if (percent > 0) return 'bg-emerald-500/20 text-emerald-100 border-emerald-500/40'
  return 'bg-input/30 text-muted-foreground border-border/40'
}

function fmtWeek(d: Date): string {
  return new Date(d).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
  })
}

export function AllocationHeatmap({ snapshots }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const { weeks, users, byCell } = useMemo(() => {
    const weekSet = new Set<string>()
    const userMap = new Map<string, string>()
    const cell = new Map<string, WeeklyAllocationSnapshot>()
    for (const s of snapshots) {
      const wk = s.weekStart.toISOString().slice(0, 10)
      weekSet.add(wk)
      userMap.set(s.userId, s.userName)
      cell.set(`${s.userId}::${wk}`, s)
    }
    const weeks = Array.from(weekSet).sort()
    const users = Array.from(userMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es-MX'))
    return { weeks, users, byCell: cell }
  }, [snapshots])

  const handleRefresh = () => {
    startTransition(async () => {
      try {
        const result = await refreshAllocationSnapshots({ daysAhead: 28 })
        toast.success(
          `${result.refreshed} snapshots recalculados (${result.users} usuarios)`,
        )
        router.refresh()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Error al recalcular',
        )
      }
    })
  }

  if (snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          Sin tareas activas con assignee y dailyEffortHours en el rango.
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-input/70 disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Recalcular snapshots
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] text-muted-foreground">
          {users.length} usuario{users.length === 1 ? '' : 's'} ·{' '}
          {weeks.length} semana{weeks.length === 1 ? '' : 's'}
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-input/70 disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Recalcular
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-muted-foreground">
                Usuario
              </th>
              {weeks.map((wk) => (
                <th
                  key={wk}
                  className="px-2 py-2 text-center text-[11px] font-semibold uppercase text-muted-foreground"
                >
                  {fmtWeek(new Date(`${wk}T00:00:00.000Z`))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border/60">
                <td className="px-3 py-2 text-xs font-medium text-foreground">
                  {u.name}
                </td>
                {weeks.map((wk) => {
                  const s = byCell.get(`${u.id}::${wk}`)
                  const percent =
                    s && s.capacityHours > 0
                      ? (s.totalHours / s.capacityHours) * 100
                      : 0
                  const cls = utilizationClass(percent)
                  return (
                    <td key={wk} className="px-1 py-1">
                      <div
                        className={`flex h-12 flex-col items-center justify-center rounded border ${cls}`}
                        title={
                          s
                            ? `${u.name} · semana ${fmtWeek(new Date(`${wk}T00:00:00.000Z`))}\n${s.totalHours}h / ${s.capacityHours}h capacity\n${s.allocations
                                .map(
                                  (a) =>
                                    `· ${a.projectName}: ${a.hours}h (${a.percent}%)`,
                                )
                                .join('\n')}`
                            : 'Sin datos'
                        }
                      >
                        {s ? (
                          <>
                            <span className="text-[11px] font-bold leading-tight">
                              {Math.round(percent)}%
                            </span>
                            <span className="text-[9px] opacity-80">
                              {s.totalHours.toFixed(0)}/{s.capacityHours.toFixed(0)}h
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px]">—</span>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span>Utilización:</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded border bg-emerald-500/20 border-emerald-500/40" />
          0-50% sub-utilizado
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded border bg-sky-500/25 border-sky-500/40" />
          50-80% saludable
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded border bg-amber-500/30 border-amber-500/50" />
          80-100% al límite
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded border bg-rose-500/40 border-rose-500/60" />
          {'>100% over-allocated'}
        </span>
      </div>
    </div>
  )
}
