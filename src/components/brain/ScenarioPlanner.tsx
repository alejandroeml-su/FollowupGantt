'use client'

/**
 * Wave P19-B · Brain Strategist · Scenario Planner UI.
 *
 * Permite simular "qué pasa si retraso X días la tarea Y" y muestra el
 * impacto downstream cross-project. También expone auto-balancing
 * suggestions (re-allocation) en una segunda sección.
 */

import { useEffect, useState, useTransition } from 'react'
import {
  Clock,
  GitFork,
  Users2,
  AlertTriangle,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  simulateTaskDelay,
  loadBalancingSuggestions,
  listTasksForScenario,
} from '@/lib/brain/strategist/scenario-actions'
import { listProjectsForBrainAnalysis } from '@/lib/brain/pm-actions'
import type { BrainProjectOption } from '@/lib/brain/pm-types'

type ScenarioResult = Awaited<ReturnType<typeof simulateTaskDelay>>
type BalanceSuggestions = Awaited<ReturnType<typeof loadBalancingSuggestions>>
type TaskOption = Awaited<ReturnType<typeof listTasksForScenario>>[number]

const SEV_TONE: Record<'HIGH' | 'MEDIUM' | 'LOW', string> = {
  HIGH: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  LOW: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
}

export function ScenarioPlanner() {
  const [projects, setProjects] = useState<BrainProjectOption[]>([])
  const [projectId, setProjectId] = useState('')
  const [tasks, setTasks] = useState<TaskOption[]>([])
  const [taskId, setTaskId] = useState('')
  const [delayDays, setDelayDays] = useState<number>(7)
  const [scenario, setScenario] = useState<ScenarioResult | null>(null)
  const [balancing, setBalancing] = useState<BalanceSuggestions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    listProjectsForBrainAnalysis()
      .then((list) => {
        if (cancelled) return
        setProjects(list)
        if (list.length > 0 && !projectId) setProjectId(list[0].id)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Error al cargar proyectos.')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load balancing suggestions on mount.
  useEffect(() => {
    startTransition(async () => {
      try {
        const r = await loadBalancingSuggestions()
        setBalancing(r)
      } catch {
        // silencioso · no bloquea el resto del panel
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load tasks when project changes.
  const [prevPid, setPrevPid] = useState('')
  if (projectId !== prevPid) {
    setPrevPid(projectId)
    if (projectId) {
      startTransition(async () => {
        try {
          const list = await listTasksForScenario({ projectId })
          setTasks(list)
          setTaskId(list[0]?.id ?? '')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Error al cargar tareas')
        }
      })
    } else {
      setTasks([])
      setTaskId('')
    }
  }

  const runScenario = () => {
    if (!taskId) {
      setError('Selecciona una tarea')
      return
    }
    if (delayDays === 0) {
      setError('Delay debe ser distinto de 0')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const r = await simulateTaskDelay({ sourceTaskId: taskId, delayDays })
        setScenario(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al simular')
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Scenario Builder */}
      <section className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/5 via-card to-card p-5">
        <header className="mb-3 flex items-center gap-2">
          <Clock className="h-5 w-5 text-violet-300" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-300">
            Predictive Scenario · ¿Qué pasa si retraso X días?
          </h3>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-2">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={projects.length === 0}
            className="rounded-md border border-border bg-background py-2 px-3 text-sm focus:border-violet-500 focus:outline-none"
          >
            {projects.length === 0 ? (
              <option value="">— Sin proyectos —</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
          <select
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            disabled={tasks.length === 0}
            className="rounded-md border border-border bg-background py-2 px-3 text-sm focus:border-violet-500 focus:outline-none"
          >
            {tasks.length === 0 ? (
              <option value="">— Sin tareas activas —</option>
            ) : (
              tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.mnemonic ? `${t.mnemonic} · ` : ''}
                  {t.title}
                </option>
              ))
            )}
          </select>
          <input
            type="number"
            value={delayDays}
            onChange={(e) => setDelayDays(Number(e.target.value))}
            placeholder="Días"
            className="rounded-md border border-border bg-background py-2 px-3 text-sm focus:border-violet-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={runScenario}
            disabled={isPending || !taskId}
            className="inline-flex items-center gap-2 rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            Simular
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {scenario && (
          <div className="mt-4 space-y-3">
            {/* Impact summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Kpi label="Tareas afectadas" value={scenario.affected.length} />
              <Kpi
                label="Cross-project"
                value={scenario.crossProjectAffected}
                tone={scenario.crossProjectAffected > 0 ? 'rose' : 'neutral'}
              />
              <Kpi
                label="Max delta"
                value={`${scenario.affected[0]?.deltaDays ?? 0}d`}
              />
              <Kpi
                label="Nuevo fin proyecto"
                value={
                  scenario.newProjectEndDate
                    ? new Date(scenario.newProjectEndDate).toLocaleDateString()
                    : '—'
                }
              />
            </div>

            {/* Affected tasks list */}
            {scenario.affected.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-background/40">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        Tarea
                      </th>
                      <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        Proyecto
                      </th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                        Delta días
                      </th>
                      <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                        Nueva fecha fin
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenario.affected.map((i) => (
                      <tr
                        key={i.taskId}
                        className={clsx(
                          'border-b border-border/40 last:border-0',
                          i.depth === 0 && 'bg-violet-500/5',
                        )}
                      >
                        <td className="px-3 py-1.5 text-foreground">
                          {i.depth === 0 ? '🎯 ' : '↳ '.repeat(Math.min(i.depth, 3))}
                          {i.taskTitle}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {i.projectName}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-rose-300">
                          +{i.deltaDays}d
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-[10px]">
                          {new Date(i.newEndDate).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Auto-balancing suggestions */}
      <section className="rounded-xl border bg-gradient-to-br from-amber-500/10 via-card to-card p-5 text-amber-300 border-amber-500/30">
        <header className="mb-3 flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2">
            <Users2 className="h-5 w-5" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">
              Auto-balancing · {balancing?.length ?? 0}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              startTransition(async () => {
                const r = await loadBalancingSuggestions()
                setBalancing(r)
              })
            }}
            className="inline-flex items-center gap-1 text-[11px] text-amber-200 hover:text-amber-100"
          >
            <RefreshCw className={clsx('h-3 w-3', isPending && 'animate-spin')} />
            Refrescar
          </button>
        </header>
        {balancing == null ? (
          <p className="text-xs text-muted-foreground italic">Cargando…</p>
        ) : balancing.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            ✅ Equipo balanceado · ningún usuario sobre-asignado (umbral &gt;8.5h/día).
          </p>
        ) : (
          <ul className="space-y-2">
            {balancing.map((b) => (
              <li
                key={`${b.userId}-${b.kind}`}
                className="rounded-md border border-border bg-background/40 p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                      SEV_TONE[b.severity],
                    )}
                  >
                    {b.severity}
                  </span>
                  <span className="text-sm font-semibold text-foreground inline-flex items-center gap-1">
                    <GitFork className="h-3.5 w-3.5" />
                    {b.userName}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {b.metrics.totalDailyHours.toFixed(1)} h/día ·{' '}
                    {b.metrics.projectsInvolved} proyectos
                    {b.metrics.averageSpi != null && (
                      <> · SPI prom. {b.metrics.averageSpi.toFixed(2)}</>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{b.message}</p>
                <p className="mt-1 text-xs text-foreground/90">{b.recommendation}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: 'rose' | 'neutral'
}) {
  const valueClass =
    tone === 'rose' && value !== 0 && value !== '0' && value !== '0d'
      ? 'text-rose-300'
      : 'text-foreground'
  return (
    <div className="rounded-md border border-border bg-background/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={clsx('mt-0.5 text-lg font-bold', valueClass)}>{value}</p>
    </div>
  )
}
