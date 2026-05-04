'use client'

/**
 * Equipo D2 · Sección "Insights AI" dentro del TaskDrawer.
 *
 * Muestra los `TaskInsight` activos para una tarea (kind:
 * CATEGORIZATION | DELAY_RISK | NEXT_ACTION). Reaprovecha el componente
 * `RiskBadge` cuando hay un insight `DELAY_RISK`.
 *
 * Decisiones (D2-IN-1..3):
 *   D2-IN-1: Carga lazy on-mount cuando se abre. La heurística de
 *            insights es no-trivial (CPU+queries) y no queremos bloquear
 *            el primer paint del drawer.
 *   D2-IN-2: "Recalcular" llama a `runProjectInsights(projectId)` (no
 *            existe variante por task — la heurística analiza el grafo
 *            completo). Tras ejecutar, recargamos los insights de la
 *            tarea actual con `getInsightsForTask`.
 *   D2-IN-3: "Descartar" llama a `dismissInsight` y filtra el item del
 *            estado local sin recargar todo el listado (idempotencia
 *            garantizada en el server).
 */

import { useEffect, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Sparkles, RefreshCw, X } from 'lucide-react'
import {
  dismissInsight,
  getInsightsForTask,
  runProjectInsights,
  type SerializedInsight,
} from '@/lib/actions/insights'
import { RiskBadge, type RiskBadgeLevel } from '@/components/ai/RiskBadge'

interface Props {
  taskId: string
  projectId?: string | null
  preloadedInsights?: SerializedInsight[]
  defaultOpen?: boolean
}

type RiskPayload = { level?: string; factors?: string[] }
type CategorizationPayload = {
  suggestedCategory?: string
  suggestedTaskType?: string
  reasoning?: string
  suggestedTags?: string[]
}
type NextActionPayload = {
  message?: string
  count?: number
  key?: string
  projectName?: string
}

function asRiskLevel(raw: unknown): RiskBadgeLevel {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw
  return 'low'
}

function kindLabel(kind: SerializedInsight['kind']): string {
  switch (kind) {
    case 'CATEGORIZATION':
      return 'Categorización'
    case 'DELAY_RISK':
      return 'Riesgo de retraso'
    case 'NEXT_ACTION':
      return 'Siguiente acción'
    default:
      return kind
  }
}

export function TaskInsightsSection({
  taskId,
  projectId,
  preloadedInsights,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState<boolean>(defaultOpen)
  const [insights, setInsights] = useState<SerializedInsight[]>(
    preloadedInsights ?? [],
  )
  const [loaded, setLoaded] = useState<boolean>(!!preloadedInsights)
  const [error, setError] = useState<string | null>(null)
  const [isRecalcPending, startRecalcTransition] = useTransition()
  const [dismissPendingId, setDismissPendingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    void (async () => {
      try {
        const items = await getInsightsForTask(taskId)
        if (cancelled) return
        setInsights(items)
        setLoaded(true)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando insights')
        setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, loaded, taskId])

  const handleDismiss = async (id: string) => {
    setDismissPendingId(id)
    try {
      await dismissInsight(id)
      setInsights((prev) => prev.filter((i) => i.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descartar')
    } finally {
      setDismissPendingId(null)
    }
  }

  const handleRecalc = () => {
    if (!projectId) {
      setError(
        'Esta tarea no está asociada a un proyecto; no se pueden recalcular insights.',
      )
      return
    }
    setError(null)
    startRecalcTransition(async () => {
      try {
        await runProjectInsights(projectId)
        const fresh = await getInsightsForTask(taskId)
        setInsights(fresh)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Error recalculando insights',
        )
      }
    })
  }

  return (
    <section
      aria-labelledby="task-insights-heading"
      className="pt-2"
      data-testid="task-insights-section"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="task-insights-body"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 border-b border-border pb-2 text-left text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span
          id="task-insights-heading"
          className="flex items-center gap-2"
        >
          <Sparkles className="h-4 w-4 text-indigo-400" /> Insights AI
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden />
        )}
      </button>

      {open && (
        <div
          id="task-insights-body"
          className="pt-3 space-y-3"
          data-testid="task-insights-body"
        >
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleRecalc}
              disabled={isRecalcPending || !projectId}
              data-testid="task-insights-recalc"
              className="flex items-center gap-1.5 rounded-md bg-indigo-500/20 px-2.5 py-1 text-[11px] font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3 w-3 ${isRecalcPending ? 'animate-spin' : ''}`}
              />
              {isRecalcPending ? 'Recalculando…' : 'Recalcular'}
            </button>
          </div>

          {!loaded && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="task-insights-loading"
            >
              Cargando insights…
            </p>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {loaded && !error && insights.length === 0 && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="task-insights-empty"
            >
              Aún no hay insights generados para esta tarea. Pulsa
              &laquo;Recalcular&raquo; para que el motor de IA los genere.
            </p>
          )}
          {loaded && insights.length > 0 && (
            <ul
              className="space-y-2"
              data-testid="task-insights-list"
            >
              {insights.map((ins) => (
                <li
                  key={ins.id}
                  className="rounded-md border border-border bg-card/40 px-3 py-2"
                  data-testid={`task-insight-${ins.kind.toLowerCase()}`}
                >
                  <header className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {kindLabel(ins.kind)}
                      </span>
                      {ins.kind === 'DELAY_RISK' && (
                        <RiskBadge
                          level={asRiskLevel(
                            (ins.payload as RiskPayload | null)?.level,
                          )}
                          score={ins.score}
                          factors={
                            (ins.payload as RiskPayload | null)?.factors
                          }
                          compact
                        />
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDismiss(ins.id)}
                      disabled={dismissPendingId === ins.id}
                      data-testid={`task-insight-dismiss-${ins.id}`}
                      className="flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3 w-3" /> Descartar
                    </button>
                  </header>
                  <InsightBody insight={ins} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export default TaskInsightsSection

function InsightBody({ insight }: { insight: SerializedInsight }) {
  if (insight.kind === 'DELAY_RISK') {
    const p = (insight.payload ?? {}) as RiskPayload
    const factors = Array.isArray(p.factors) ? p.factors : []
    return (
      <ul className="space-y-0.5 text-[11px] text-muted-foreground">
        {factors.length === 0 ? (
          <li>Sin factores destacados.</li>
        ) : (
          factors.map((f, idx) => <li key={idx}>· {f}</li>)
        )}
      </ul>
    )
  }
  if (insight.kind === 'CATEGORIZATION') {
    const p = (insight.payload ?? {}) as CategorizationPayload
    return (
      <div className="space-y-1 text-[11px] text-muted-foreground">
        {p.suggestedCategory && (
          <p>
            <span className="text-foreground/80">Categoría sugerida:</span>{' '}
            {p.suggestedCategory}
          </p>
        )}
        {p.suggestedTaskType && (
          <p>
            <span className="text-foreground/80">Tipo sugerido:</span>{' '}
            {p.suggestedTaskType}
          </p>
        )}
        {p.reasoning && <p className="italic">{p.reasoning}</p>}
        {Array.isArray(p.suggestedTags) && p.suggestedTags.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {p.suggestedTags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-secondary px-2 py-0.5 text-[10px]"
              >
                {t}
              </span>
            ))}
          </p>
        )}
      </div>
    )
  }
  if (insight.kind === 'NEXT_ACTION') {
    const p = (insight.payload ?? {}) as NextActionPayload
    return (
      <p className="text-[11px] text-muted-foreground">
        {p.message ?? 'Sin descripción.'}
        {typeof p.count === 'number' ? ` (${p.count})` : ''}
      </p>
    )
  }
  return null
}
