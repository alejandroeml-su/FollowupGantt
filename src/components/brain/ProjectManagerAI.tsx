'use client'

/**
 * Project Manager AI · Avante Brain.
 *
 * Wave P14c — análisis contextualizado por proyecto:
 *   1. Selector de proyecto obligatorio antes de generar.
 *   2. El LLM recibe contexto del proyecto + risks YA REGISTRADOS para
 *      no duplicarlos.
 *   3. Cada alerta tiene un botón "Registrar en proyecto" que persiste
 *      el Risk en `Risk Register` con probability/impact/mitigation y
 *      vínculo a la task específica (vía mnemonic).
 */

import { useEffect, useState, useTransition } from 'react'
import {
  Bot,
  Zap,
  AlertTriangle,
  Activity,
  RefreshCw,
  Database,
  ArrowUpRight,
  Check,
  ListChecks,
  Plus,
} from 'lucide-react'
import {
  generateStandupReport,
  generateRiskAnalysis,
  registerRiskFromAlert,
  listProjectsForBrainAnalysis,
} from '@/lib/brain/pm-actions'
import type {
  StandupReport,
  RiskReport,
  RiskAlert,
  BrainProjectOption,
} from '@/lib/brain/pm-types'

const STATUS_COLORS: Record<RiskReport['overallStatus'], { dot: string; label: string; text: string }> = {
  HEALTHY: { dot: 'bg-emerald-400', label: 'Saludable', text: 'text-emerald-400' },
  AT_RISK: { dot: 'bg-amber-400', label: 'En riesgo', text: 'text-amber-400' },
  CRITICAL: { dot: 'bg-red-400', label: 'Crítico', text: 'text-red-400' },
}

const SEVERITY_STYLE: Record<
  RiskAlert['severity'],
  { border: string; text: string; bg: string }
> = {
  LOW: { border: 'border-emerald-500/30', text: 'text-emerald-300', bg: 'bg-emerald-500/5' },
  MEDIUM: { border: 'border-amber-500/30', text: 'text-amber-300', bg: 'bg-amber-500/5' },
  HIGH: { border: 'border-red-500/40', text: 'text-red-300', bg: 'bg-red-500/10' },
}

export function ProjectManagerAI() {
  const [projects, setProjects] = useState<BrainProjectOption[]>([])
  const [projectId, setProjectId] = useState<string>('')
  const [standup, setStandup] = useState<StandupReport | null>(null)
  const [risks, setRisks] = useState<RiskReport | null>(null)
  const [registered, setRegistered] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Cargar lista de proyectos al montar
  useEffect(() => {
    let cancelled = false
    listProjectsForBrainAnalysis()
      .then((list) => {
        if (cancelled) return
        setProjects(list)
        // Pre-seleccionar el primer proyecto disponible
        if (list.length > 0 && !projectId) setProjectId(list[0].id)
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Error al cargar proyectos.',
          )
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedProject = projects.find((p) => p.id === projectId)

  const generate = () => {
    if (!projectId) {
      setError('Selecciona un proyecto antes de generar el análisis.')
      return
    }
    setError(null)
    setRegistered(new Set())
    startTransition(async () => {
      try {
        const [s, r] = await Promise.all([
          generateStandupReport({ projectId }),
          generateRiskAnalysis({ projectId }),
        ])
        setStandup(s)
        setRisks(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al generar el análisis.')
      }
    })
  }

  const handleRegister = (alert: RiskAlert, idx: number) => {
    if (!projectId || registered.has(idx)) return
    startTransition(async () => {
      try {
        await registerRiskFromAlert({ projectId, alert })
        setRegistered((prev) => {
          const next = new Set(prev)
          next.add(idx)
          return next
        })
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Error al registrar el riesgo.',
        )
      }
    })
  }

  return (
    <div className="flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <Bot className="h-6 w-6 text-purple-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Project Manager AI</h2>
            <p className="text-muted-foreground text-sm">
              Análisis contextual por proyecto · risks van directo al Risk Register sin duplicar.
            </p>
          </div>
        </div>
      </div>

      {/* Wave P14c · Selector de proyecto + acción */}
      <div className="mb-6 rounded-xl border border-border bg-card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Proyecto a analizar <span className="text-rose-400">*</span>
          </label>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value)
              setStandup(null)
              setRisks(null)
              setRegistered(new Set())
            }}
            disabled={projects.length === 0}
            className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          >
            {projects.length === 0 ? (
              <option value="">No hay proyectos disponibles</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.methodology} · {p.status}
                </option>
              ))
            )}
          </select>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={isPending || !projectId}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
          {isPending ? 'Generando…' : standup || risks ? 'Regenerar' : 'Generar análisis'}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">No se pudo completar la operación</p>
            <p className="text-xs text-red-300/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      {!standup && !risks && !isPending && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <Bot className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
          <p className="mt-3 text-sm text-foreground">
            Selecciona un proyecto y haz click en{' '}
            <span className="font-semibold text-indigo-300">Generar análisis</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            La IA contextualizará stand-up y riesgos solo con datos de ese proyecto y excluirá los riesgos ya registrados.
          </p>
        </div>
      )}

      {(standup || risks || isPending) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <StandupCard report={standup} loading={isPending && !standup} />
          <RiskCard
            report={risks}
            loading={isPending && !risks}
            projectName={selectedProject?.name}
            onRegister={handleRegister}
            registered={registered}
            actionPending={isPending}
          />
        </div>
      )}
    </div>
  )
}

// ─── Stand-up card ────────────────────────────────────────────────

function StandupCard({ report, loading }: { report: StandupReport | null; loading: boolean }) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-4 w-4 text-emerald-400" />
        <h3 className="font-semibold text-foreground">Stand-up · Hoy</h3>
        {report && (
          <span className="text-[10px] text-muted-foreground ml-auto font-mono">{report.date}</span>
        )}
      </div>

      {loading || !report ? (
        <SkeletonLines count={4} />
      ) : (
        <div className="space-y-4 text-sm text-foreground/90">
          <p className="leading-relaxed">{report.summary}</p>

          {report.byUser.length === 0 ? (
            <p className="text-muted-foreground text-xs italic">
              Sin actividad registrada en las últimas 24h.
            </p>
          ) : (
            <div className="space-y-3">
              {report.byUser.map((u) => (
                <div key={u.userName} className="rounded-lg bg-background/60 border border-border/50 p-3">
                  <p className="font-semibold text-foreground text-xs uppercase tracking-wider mb-2">
                    {u.userName}
                  </p>
                  {u.completedToday.length > 0 && (
                    <div className="text-xs mb-1.5">
                      <span className="text-emerald-400">✓ Completadas: </span>
                      {u.completedToday.map((t, i) => (
                        <span key={`${u.userName}-c-${i}`} className="text-muted-foreground">
                          {t.mnemonic && <code className="text-emerald-300">[{t.mnemonic}]</code>} {t.title}
                          {i < u.completedToday.length - 1 && ', '}
                        </span>
                      ))}
                    </div>
                  )}
                  {u.inProgress.length > 0 && (
                    <div className="text-xs">
                      <span className="text-indigo-400">→ En progreso: </span>
                      {u.inProgress.map((t, i) => (
                        <span key={`${u.userName}-p-${i}`} className="text-muted-foreground">
                          {t.mnemonic && <code className="text-indigo-300">[{t.mnemonic}]</code>} {t.title}{' '}
                          <span className="text-foreground/60">({t.progress}%)</span>
                          {i < u.inProgress.length - 1 && ', '}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {report.blockers.length > 0 && (
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
              <p className="text-xs font-semibold text-amber-300 mb-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Cuellos de botella
              </p>
              <ul className="text-xs text-foreground/80 space-y-1 list-disc pl-4">
                {report.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground italic flex items-center gap-1.5 pt-2 border-t border-border/40">
            <Activity className="h-3 w-3" />
            {report.globalProgressNote}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Risk card ────────────────────────────────────────────────────

function RiskCard({
  report,
  loading,
  projectName,
  onRegister,
  registered,
  actionPending,
}: {
  report: RiskReport | null
  loading: boolean
  projectName?: string
  onRegister: (alert: RiskAlert, idx: number) => void
  registered: Set<number>
  actionPending: boolean
}) {
  const status = report ? STATUS_COLORS[report.overallStatus] : null

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 blur-3xl rounded-full pointer-events-none" />
      <div className="flex items-center gap-2 mb-4 relative z-10">
        <Database className="h-4 w-4 text-red-400" />
        <h3 className="font-semibold text-foreground">
          Análisis de Riesgos · {projectName ?? 'Proyecto'}
        </h3>
        {status && (
          <span className={`ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold ${status.text}`}>
            <span className={`h-2 w-2 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        )}
      </div>

      {loading || !report ? (
        <SkeletonLines count={5} />
      ) : (
        <div className="space-y-3 relative z-10">
          <p className="text-sm text-foreground/90 leading-relaxed">{report.headline}</p>

          {report.alerts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No se detectaron alertas relevantes.
            </p>
          ) : (
            <div className="space-y-2">
              {report.alerts.map((a, i) => {
                const style = SEVERITY_STYLE[a.severity]
                const isRegistered = registered.has(i)
                return (
                  <div
                    key={i}
                    className={`rounded-lg border ${style.border} ${style.bg} p-3 space-y-1.5`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${style.text} shrink-0 mt-0.5`}
                      >
                        {a.severity}
                      </span>
                      <p className="text-xs font-semibold text-foreground flex-1">
                        {a.taskMnemonic && (
                          <code className={`mr-1.5 ${style.text}`}>[{a.taskMnemonic}]</code>
                        )}
                        {a.title}
                      </p>
                      <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                        P{a.probability}×I{a.impact}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{a.rationale}</p>
                    <div className="flex items-start gap-1.5 text-[11px] text-foreground/90 pt-1">
                      <ArrowUpRight className="h-3 w-3 text-indigo-400 mt-0.5 shrink-0" />
                      <span className="font-medium shrink-0">Mitigación:</span>
                      <span className="text-muted-foreground flex-1">{a.suggestedAction}</span>
                    </div>
                    {a.triggerDelayDays > 0 && (
                      <p className="text-[10px] text-amber-400/80">
                        ⏱ +{a.triggerDelayDays}d al cronograma si se materializa
                      </p>
                    )}
                    <div className="pt-1.5 border-t border-border/40 flex items-center justify-end">
                      {isRegistered ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                          <Check className="h-3 w-3" /> Registrado en Risk Register
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRegister(a, i)}
                          disabled={actionPending}
                          className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
                        >
                          <Plus className="h-3 w-3" />
                          Registrar en proyecto
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {report.alerts.length > 0 && (
            <p className="text-[10px] text-muted-foreground italic pt-2 border-t border-border/40 flex items-center gap-1">
              <ListChecks className="h-3 w-3" />
              Las alertas no se duplican: el LLM excluye riesgos ya registrados en este proyecto.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────

const SKELETON_WIDTHS = ['90%', '70%', '85%', '60%', '78%', '65%']

function SkeletonLines({ count }: { count: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded bg-secondary/60"
          style={{ width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }}
        />
      ))}
    </div>
  )
}
