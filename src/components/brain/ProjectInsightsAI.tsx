'use client'

/**
 * Wave P15 (Brain Project Insights AI ampliado).
 *
 * Tab "Project Insights AI" del Brain · análisis predictivo proactivo:
 *   - 3 FORECAST (predicciones cuantitativas)
 *   - 3 RECOMMENDATION (acciones sugeridas)
 *   - 3 ANOMALY (alertas detectadas)
 *
 * Cada insight tiene "Aplicar" (crea Risk/Improvement/Task según
 * `relatedAction`) o "Descartar" (no se vuelve a sugerir).
 */

import { useEffect, useState, useTransition } from 'react'
import {
  Bot,
  RefreshCw,
  AlertTriangle,
  Check,
  Sparkles,
  TrendingUp,
  Lightbulb,
  ShieldAlert,
  X as XIcon,
  Plus,
} from 'lucide-react'
import {
  generateProjectInsights,
  listProjectInsights,
  applyInsight,
  dismissInsight,
} from '@/lib/brain/insights-actions'
import { listProjectsForBrainAnalysis } from '@/lib/brain/pm-actions'
import type { BrainProjectOption } from '@/lib/brain/pm-types'

type InsightRow = {
  id: string
  kind: 'FORECAST' | 'RECOMMENDATION' | 'ANOMALY'
  title: string
  body: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  status: 'NEW' | 'APPLIED' | 'DISMISSED'
  relatedAction: unknown
}

const KIND_META: Record<
  InsightRow['kind'],
  { label: string; icon: typeof TrendingUp; classes: string; bgGradient: string }
> = {
  FORECAST: {
    label: 'Forecast',
    icon: TrendingUp,
    classes: 'text-cyan-300 border-cyan-500/30',
    bgGradient: 'from-cyan-500/10 via-card to-card',
  },
  RECOMMENDATION: {
    label: 'Recommendation',
    icon: Lightbulb,
    classes: 'text-amber-300 border-amber-500/30',
    bgGradient: 'from-amber-500/10 via-card to-card',
  },
  ANOMALY: {
    label: 'Anomaly',
    icon: ShieldAlert,
    classes: 'text-rose-300 border-rose-500/30',
    bgGradient: 'from-rose-500/10 via-card to-card',
  },
}

const SEV_TAG: Record<InsightRow['severity'], string> = {
  HIGH: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  LOW: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
}

export function ProjectInsightsAI() {
  const [projects, setProjects] = useState<BrainProjectOption[]>([])
  const [projectId, setProjectId] = useState<string>('')
  const [insights, setInsights] = useState<InsightRow[]>([])
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

  const loadExisting = (pid: string) => {
    if (!pid) return
    startTransition(async () => {
      try {
        const rows = await listProjectInsights({ projectId: pid })
        setInsights(
          rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            body: r.body,
            severity: r.severity,
            status: r.status,
            relatedAction: r.relatedAction,
          })),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar insights.')
      }
    })
  }

  const [prevProjectId, setPrevProjectId] = useState('')
  if (projectId !== prevProjectId) {
    setPrevProjectId(projectId)
    if (projectId) loadExisting(projectId)
    else setInsights([])
  }

  const generate = () => {
    if (!projectId) {
      setError('Selecciona un proyecto.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await generateProjectInsights({ projectId })
        // Refresh la lista (incluye los nuevos)
        const rows = await listProjectInsights({ projectId })
        setInsights(
          rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            title: r.title,
            body: r.body,
            severity: r.severity,
            status: r.status,
            relatedAction: r.relatedAction,
          })),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al generar insights.')
      }
    })
  }

  const handleApply = (id: string) => {
    startTransition(async () => {
      try {
        await applyInsight({ insightId: id })
        setInsights((prev) =>
          prev.map((i) => (i.id === id ? { ...i, status: 'APPLIED' } : i)),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al aplicar.')
      }
    })
  }

  const handleDismiss = (id: string) => {
    startTransition(async () => {
      try {
        await dismissInsight({ insightId: id })
        setInsights((prev) => prev.filter((i) => i.id !== id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al descartar.')
      }
    })
  }

  const grouped = {
    FORECAST: insights.filter((i) => i.kind === 'FORECAST' && i.status !== 'DISMISSED'),
    RECOMMENDATION: insights.filter(
      (i) => i.kind === 'RECOMMENDATION' && i.status !== 'DISMISSED',
    ),
    ANOMALY: insights.filter((i) => i.kind === 'ANOMALY' && i.status !== 'DISMISSED'),
  }

  return (
    <div className="flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
            <Bot className="h-6 w-6 text-purple-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Project Insights AI
            </h2>
            <p className="text-muted-foreground text-sm">
              Análisis predictivo proactivo · 3 forecast · 3 recommendations · 3 anomalies por proyecto.
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Proyecto a analizar <span className="text-rose-400">*</span>
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
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
          {isPending ? 'Generando…' : 'Generar insights'}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {insights.length === 0 && !isPending && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <Sparkles className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
          <p className="mt-3 text-sm text-foreground">
            Selecciona un proyecto y haz click en{' '}
            <span className="font-semibold text-indigo-300">Generar insights</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            La IA analizará el proyecto y devolverá hasta 9 insights agrupados en 3 categorías. Excluye los ya aplicados o descartados.
          </p>
        </div>
      )}

      {insights.length > 0 && (
        <div className="space-y-6">
          {(['FORECAST', 'RECOMMENDATION', 'ANOMALY'] as const).map((kind) => {
            const items = grouped[kind]
            if (items.length === 0) return null
            const meta = KIND_META[kind]
            const Icon = meta.icon
            return (
              <section
                key={kind}
                className={`rounded-xl border bg-gradient-to-br ${meta.bgGradient} ${meta.classes} p-5`}
              >
                <header className="mb-3 flex items-center gap-2">
                  <Icon className="h-5 w-5" />
                  <h3 className="text-sm font-semibold uppercase tracking-wider">
                    {meta.label} · {items.length}
                  </h3>
                </header>
                <div className="space-y-2">
                  {items.map((it) => (
                    <InsightCard
                      key={it.id}
                      insight={it}
                      onApply={() => handleApply(it.id)}
                      onDismiss={() => handleDismiss(it.id)}
                      pending={isPending}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InsightCard({
  insight,
  onApply,
  onDismiss,
  pending,
}: {
  insight: InsightRow
  onApply: () => void
  onDismiss: () => void
  pending: boolean
}) {
  const action = insight.relatedAction as
    | { type: string; payload?: Record<string, unknown> }
    | null
  const actionType = action?.type ?? 'none'
  const isApplied = insight.status === 'APPLIED'

  return (
    <article className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${SEV_TAG[insight.severity]}`}
        >
          {insight.severity}
        </span>
        <h4 className="text-sm font-semibold text-foreground flex-1">
          {insight.title}
        </h4>
        {isApplied && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300">
            <Check className="h-3 w-3" /> Aplicado
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{insight.body}</p>

      {!isApplied && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
          {actionType !== 'none' && (
            <button
              type="button"
              onClick={onApply}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-500/20 px-2.5 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
              title={`Aplicar: ${actionType}`}
            >
              <Plus className="h-3 w-3" />
              Aplicar ·{' '}
              {actionType === 'create_risk'
                ? 'Crear Risk'
                : actionType === 'create_improvement'
                  ? 'Crear Improvement'
                  : actionType === 'create_task'
                    ? 'Crear Task'
                    : 'Aplicar'}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50"
          >
            <XIcon className="h-3 w-3" />
            Descartar
          </button>
        </div>
      )}
    </article>
  )
}
