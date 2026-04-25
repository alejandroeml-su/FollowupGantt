'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  Bot,
  Zap,
  AlertTriangle,
  Activity,
  RefreshCw,
  Database,
  ArrowUpRight,
} from 'lucide-react'
import {
  generateStandupReport,
  generateRiskAnalysis,
  type StandupReport,
  type RiskReport,
} from '@/lib/brain/pm-actions'

const STATUS_COLORS: Record<RiskReport['overallStatus'], { dot: string; label: string; text: string }> = {
  HEALTHY: { dot: 'bg-emerald-400', label: 'Saludable', text: 'text-emerald-400' },
  AT_RISK: { dot: 'bg-amber-400', label: 'En riesgo', text: 'text-amber-400' },
  CRITICAL: { dot: 'bg-red-400', label: 'Crítico', text: 'text-red-400' },
}

const SEVERITY_STYLE: Record<
  RiskReport['alerts'][number]['severity'],
  { border: string; text: string; bg: string }
> = {
  LOW: { border: 'border-emerald-500/30', text: 'text-emerald-300', bg: 'bg-emerald-500/5' },
  MEDIUM: { border: 'border-amber-500/30', text: 'text-amber-300', bg: 'bg-amber-500/5' },
  HIGH: { border: 'border-red-500/40', text: 'text-red-300', bg: 'bg-red-500/10' },
}

export function ProjectManagerAI() {
  const [standup, setStandup] = useState<StandupReport | null>(null)
  const [risks, setRisks] = useState<RiskReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const load = () => {
    setError(null)
    startTransition(async () => {
      try {
        const [s, r] = await Promise.all([generateStandupReport(), generateRiskAnalysis()])
        setStandup(s)
        setRisks(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al generar el análisis.')
      }
    })
  }

  useEffect(() => {
    // Carga inicial al montar el tab. El reset es por transición (mount),
    // no derivación de props durante render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [])

  return (
    <div className="flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <Bot className="h-6 w-6 text-purple-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Project Manager AI</h2>
            <p className="text-muted-foreground text-sm">
              Stand-up y análisis de riesgos generados con datos reales de las últimas 24h.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={isPending}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:border-indigo-500/50 text-xs font-medium text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
          {isPending ? 'Generando…' : 'Regenerar'}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">No se pudo generar el análisis</p>
            <p className="text-xs text-red-300/80 mt-1">{error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StandupCard report={standup} loading={isPending && !standup} />
        <RiskCard report={risks} loading={isPending && !risks} />
      </div>
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

function RiskCard({ report, loading }: { report: RiskReport | null; loading: boolean }) {
  const status = report ? STATUS_COLORS[report.overallStatus] : null

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 blur-3xl rounded-full pointer-events-none" />
      <div className="flex items-center gap-2 mb-4 relative z-10">
        <Database className="h-4 w-4 text-red-400" />
        <h3 className="font-semibold text-foreground">Análisis de Riesgos · EVM</h3>
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
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{a.rationale}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-foreground/90 pt-1">
                      <ArrowUpRight className="h-3 w-3 text-indigo-400" />
                      <span className="font-medium">Acción sugerida:</span>
                      <span className="text-muted-foreground">{a.suggestedAction}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────

// Widths deterministas para skeleton (evita Math.random durante render).
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

