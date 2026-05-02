'use client'

import { useState, useMemo } from 'react'
import { utilizationTier } from '@/lib/workload/compute'
import { AlertCircle } from 'lucide-react'

interface SerializedCell {
  weekStart: string
  userId: string
  plannedHours: number
  availableHours: number
  utilization: number
  tasks: { id: string; title: string; projectName?: string; hours: number }[]
}

interface Props {
  data: {
    weeks: string[]
    users: { id: string; name: string }[]
    cells: SerializedCell[]
  }
}

const TIER_BG: Record<ReturnType<typeof utilizationTier>, string> = {
  green: 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/30',
  yellow: 'bg-amber-400/20 hover:bg-amber-400/30 border-amber-400/30',
  orange: 'bg-orange-500/30 hover:bg-orange-500/40 border-orange-500/40',
  red: 'bg-red-500/30 hover:bg-red-500/40 border-red-500/40',
}

function formatWeek(iso: string) {
  const d = new Date(iso)
  const month = d.toLocaleDateString('es', { month: 'short' })
  return `${d.getUTCDate()} ${month}`
}

export function WorkloadHeatmap({ data }: Props) {
  const [selected, setSelected] = useState<SerializedCell | null>(null)

  const cellByKey = useMemo(() => {
    const map = new Map<string, SerializedCell>()
    for (const c of data.cells) {
      map.set(`${c.userId}::${c.weekStart}`, c)
    }
    return map
  }, [data.cells])

  return (
    <div className="space-y-6" data-testid="workload-heatmap">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>Leyenda:</span>
        <Legend label="0–50%" tier="green" />
        <Legend label="50–80%" tier="yellow" />
        <Legend label="80–100%" tier="orange" />
        <Legend label=">100%" tier="red" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-secondary/40 p-2 text-left text-muted-foreground border-b border-r border-border min-w-[160px]">
                Recurso
              </th>
              {data.weeks.map((w) => (
                <th
                  key={w}
                  className="bg-secondary/40 p-2 text-center font-medium text-muted-foreground border-b border-border min-w-[70px]"
                >
                  {formatWeek(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.users.map((user) => (
              <tr key={user.id}>
                <td className="sticky left-0 z-10 bg-card p-2 border-b border-r border-border">
                  <div className="font-medium text-white">{user.name}</div>
                </td>
                {data.weeks.map((w) => {
                  const cell = cellByKey.get(`${user.id}::${w}`)
                  if (!cell) {
                    return (
                      <td
                        key={w}
                        className="border-b border-border p-1 text-center text-muted-foreground"
                      >
                        —
                      </td>
                    )
                  }
                  const tier = utilizationTier(cell.utilization)
                  const pct = Math.round(cell.utilization * 100)
                  return (
                    <td
                      key={w}
                      className="border-b border-border p-1"
                      data-testid={`cell-${user.id}-${w}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelected(cell)}
                        className={`w-full rounded-md border px-2 py-1.5 text-center transition ${TIER_BG[tier]}`}
                        title={`${cell.plannedHours.toFixed(1)}h / ${cell.availableHours.toFixed(0)}h`}
                      >
                        <div className="font-mono text-[11px] font-semibold text-white">
                          {pct}%
                        </div>
                        {tier === 'red' && (
                          <AlertCircle className="mx-auto h-3 w-3 text-red-300" />
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div
          className="rounded-xl border border-border bg-card p-4"
          data-testid="cell-drilldown"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white">
              Drilldown — Semana {formatWeek(selected.weekStart)} ·{' '}
              {data.users.find((u) => u.id === selected.userId)?.name}
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cerrar
            </button>
          </div>

          <div className="text-xs text-muted-foreground mb-2">
            {selected.plannedHours.toFixed(1)}h planificadas /{' '}
            {selected.availableHours.toFixed(0)}h disponibles ·{' '}
            {Math.round(selected.utilization * 100)}% utilización
          </div>

          {selected.tasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No hay tareas en esta celda.
            </p>
          ) : (
            <ul className="space-y-1">
              {selected.tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs"
                >
                  <div>
                    <p className="font-medium text-foreground">{t.title}</p>
                    <p className="text-muted-foreground">{t.projectName ?? '—'}</p>
                  </div>
                  <span className="font-mono text-muted-foreground">
                    {t.hours.toFixed(1)}h
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Legend({
  label,
  tier,
}: {
  label: string
  tier: ReturnType<typeof utilizationTier>
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block h-3 w-3 rounded-sm border ${TIER_BG[tier]}`}
      />
      {label}
    </span>
  )
}
