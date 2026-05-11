'use client'

/**
 * Wave P19-D · Brain Strategist History — UI de historial persistente.
 *
 * Lista paginada de insights cross-project persistidos en
 * `BrainStrategistInsight`. Permite:
 *   - Filtrar por kind, severity, status.
 *   - ACK / Resolve / Dismiss inline.
 *   - "Persistir snapshot actual" para guardar el report vigente
 *     (recibido por prop desde el padre <StrategistAI/>).
 *
 * Componente client puro: todas las mutaciones van a server actions
 * en `@/lib/brain/strategist/persistence.ts`.
 */

import { useCallback, useEffect, useState, useTransition } from 'react'
import { clsx } from 'clsx'
import {
  Archive,
  CheckCircle2,
  Clock,
  History,
  RefreshCw,
  Save,
  XCircle,
} from 'lucide-react'
import {
  acknowledgeInsight,
  dismissInsight,
  listStrategistInsights,
  persistStrategistReport,
  resolveInsight,
  type ListStrategistInsightsInput,
  type StrategistInsightKindKey,
  type StrategistInsightRow,
  type StrategistInsightSeverityKey,
  type StrategistInsightStatus,
} from '@/lib/brain/strategist/persistence'
import type { StrategistReport } from '@/lib/brain/strategist/actions'

const SEV_TONE: Record<StrategistInsightSeverityKey, string> = {
  HIGH: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  LOW: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
}

const STATUS_TONE: Record<StrategistInsightStatus, string> = {
  NEW: 'bg-violet-500/20 text-violet-200 border-violet-500/40',
  ACKNOWLEDGED: 'bg-sky-500/20 text-sky-200 border-sky-500/40',
  RESOLVED: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  DISMISSED: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
}

const KIND_LABEL: Record<StrategistInsightKindKey, string> = {
  RESOURCE_CONTENTION: 'Resource contention',
  DEPENDENCY_CONFLICT: 'Dependency conflict',
  REUSABLE_LESSON: 'Reusable lesson',
  PREDICTIVE_SCENARIO: 'Predictive scenario',
  BALANCE_SUGGESTION: 'Balance suggestion',
}

interface StrategistHistoryProps {
  /** Report vigente para el botón "Persistir snapshot actual". */
  currentReport: StrategistReport | null
  /** Workspace activo (opcional). Si no se pasa, scope = global (null). */
  workspaceId?: string | null
}

export function StrategistHistory({
  currentReport,
  workspaceId,
}: StrategistHistoryProps) {
  const [items, setItems] = useState<StrategistInsightRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isLoading, startLoading] = useTransition()
  const [isMutating, startMutation] = useTransition()
  const [isPersisting, startPersist] = useTransition()

  // Filtros UI.
  const [kindFilter, setKindFilter] = useState<StrategistInsightKindKey | ''>('')
  const [severityFilter, setSeverityFilter] =
    useState<StrategistInsightSeverityKey | ''>('')
  const [statusFilter, setStatusFilter] = useState<StrategistInsightStatus | ''>('')

  const loadPage = useCallback(
    (cursor?: string) => {
      setError(null)
      startLoading(async () => {
        try {
          const input: ListStrategistInsightsInput = {
            ...(kindFilter ? { kind: kindFilter } : {}),
            ...(severityFilter ? { severity: severityFilter } : {}),
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(workspaceId !== undefined
              ? { workspaceId: workspaceId ?? null }
              : {}),
            ...(cursor ? { cursor } : {}),
            limit: 25,
          }
          const res = await listStrategistInsights(input)
          setItems((prev) => (cursor ? [...prev, ...res.items] : res.items))
          setNextCursor(res.nextCursor)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Error al cargar historial')
        }
      })
    },
    [kindFilter, severityFilter, statusFilter, workspaceId],
  )

  // Refresca al cambiar filtros. `loadPage` ya envuelve sus updates en
  // startTransition (useTransition), pero el linter no detecta el wrap
  // a través del callback memoizado — disable explícito.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPage(undefined)
  }, [loadPage])

  const persistSnapshot = () => {
    if (!currentReport) return
    setError(null)
    setInfo(null)
    startPersist(async () => {
      try {
        const res = await persistStrategistReport(
          currentReport,
          workspaceId ?? null,
        )
        setInfo(
          `Snapshot persistido · ${res.created} nuevos · ${res.skipped} dedup ` +
            `(de ${res.total} insights del report).`,
        )
        loadPage(undefined)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al persistir snapshot')
      }
    })
  }

  const ack = (id: string) => {
    setError(null)
    startMutation(async () => {
      try {
        const updated = await acknowledgeInsight({ id })
        setItems((prev) => prev.map((it) => (it.id === id ? updated : it)))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al ACK')
      }
    })
  }

  const resolve = (id: string) => {
    setError(null)
    startMutation(async () => {
      try {
        const updated = await resolveInsight({ id })
        setItems((prev) => prev.map((it) => (it.id === id ? updated : it)))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al resolver')
      }
    })
  }

  const dismiss = (id: string) => {
    setError(null)
    startMutation(async () => {
      try {
        const updated = await dismissInsight({ id })
        setItems((prev) => prev.map((it) => (it.id === id ? updated : it)))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al descartar')
      }
    })
  }

  return (
    <section className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-card to-card p-5">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <History className="h-5 w-5 text-violet-300" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-200">
          Historial · Insights persistidos
        </h3>
        <span className="rounded-full border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-200">
          {items.length}
          {nextCursor ? '+' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => loadPage(undefined)}
            disabled={isLoading}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-background/60 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            Recargar
          </button>
          <button
            type="button"
            onClick={persistSnapshot}
            disabled={isPersisting || !currentReport}
            title={
              currentReport
                ? 'Persistir el report visible como punto histórico'
                : 'Carga primero el análisis cross-project'
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
          >
            <Save className={clsx('h-3.5 w-3.5', isPersisting && 'animate-pulse')} />
            {isPersisting ? 'Guardando…' : 'Persistir snapshot actual'}
          </button>
        </div>
      </header>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <select
          value={kindFilter}
          onChange={(e) =>
            setKindFilter(e.target.value as StrategistInsightKindKey | '')
          }
          aria-label="Filtrar por tipo"
          className="rounded-md border border-border bg-background/40 px-2 py-1.5 text-foreground"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(e) =>
            setSeverityFilter(
              e.target.value as StrategistInsightSeverityKey | '',
            )
          }
          aria-label="Filtrar por severidad"
          className="rounded-md border border-border bg-background/40 px-2 py-1.5 text-foreground"
        >
          <option value="">Cualquier severidad</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as StrategistInsightStatus | '')
          }
          aria-label="Filtrar por estado"
          className="rounded-md border border-border bg-background/40 px-2 py-1.5 text-foreground"
        >
          <option value="">Cualquier estado</option>
          <option value="NEW">NEW</option>
          <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="DISMISSED">DISMISSED</option>
        </select>
      </div>

      {info && (
        <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {info}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {items.length === 0 && !isLoading ? (
        <p className="rounded-md border border-dashed border-border bg-background/20 px-3 py-6 text-center text-xs text-muted-foreground italic">
          Sin insights persistidos con los filtros actuales. Usa &ldquo;Persistir
          snapshot actual&rdquo; para guardar el report vigente como primer
          punto del historial.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-lg border border-border bg-background/40 p-3"
            >
              <div className="flex flex-wrap items-start gap-2">
                <span
                  className={clsx(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                    SEV_TONE[it.severity],
                  )}
                >
                  {it.severity}
                </span>
                <span
                  className={clsx(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                    STATUS_TONE[it.status],
                  )}
                >
                  {it.status}
                </span>
                <span className="rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {KIND_LABEL[it.kind]}
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {new Date(it.createdAt).toLocaleString('es-MX')}
                </span>
              </div>
              <p className="mt-2 text-xs text-foreground">
                {it.summary ?? 'Sin resumen.'}
              </p>
              {it.ackByName && it.ackedAt && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Reconocido por {it.ackByName} ·{' '}
                  {new Date(it.ackedAt).toLocaleString('es-MX')}
                </p>
              )}
              {it.resolvedAt && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Resuelto: {new Date(it.resolvedAt).toLocaleString('es-MX')}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {it.status === 'NEW' && (
                  <button
                    type="button"
                    onClick={() => ack(it.id)}
                    disabled={isMutating}
                    className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Acknowledge
                  </button>
                )}
                {it.status !== 'RESOLVED' && it.status !== 'DISMISSED' && (
                  <button
                    type="button"
                    onClick={() => resolve(it.id)}
                    disabled={isMutating}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                  >
                    <Archive className="h-3 w-3" />
                    Resolve
                  </button>
                )}
                {it.status !== 'DISMISSED' && (
                  <button
                    type="button"
                    onClick={() => dismiss(it.id)}
                    disabled={isMutating}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-500/40 bg-slate-500/10 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-500/20 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="h-3 w-3" />
                    Dismiss
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => loadPage(nextCursor)}
            disabled={isLoading}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/60 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            Cargar más
          </button>
        </div>
      )}
    </section>
  )
}
