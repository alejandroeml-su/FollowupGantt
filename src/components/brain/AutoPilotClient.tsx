'use client'

/**
 * Wave P20-C · Brain Auto-Pilot — Cliente.
 *
 * Lista proposals + historial con apply/rollback. UI sigue las convenciones
 * de StrategistAI (gradients indigo · cards translucent · severity tones).
 *
 * Flujo:
 *   1. Mount → `listProposals()` server action
 *   2. Apply → confirm dialog → `applyProposalById` → recargar lista
 *   3. Historial expandible → `rollbackRun` con guard 24h en UI
 */

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  Wand2,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Undo2,
  Play,
  History,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  listProposals,
  applyProposalById,
  rollbackRun,
  listAutoPilotHistory,
} from '@/lib/actions/auto-pilot'
import type {
  AutoPilotProposal,
  AutoPilotRunRow,
  AutoPilotSeverity,
} from '@/lib/brain/auto-pilot/types'

const SEV_TONE: Record<AutoPilotSeverity, string> = {
  HIGH: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  MEDIUM: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  LOW: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
}

const KIND_LABEL: Record<string, string> = {
  SPRINT_REBALANCE: 'Balanceo de sprint',
  ASSIGNEE_REBALANCE: 'Balanceo de asignación',
  SPRINT_EXTENSION: 'Extensión de sprint',
  LESSON_PROMOTION: 'Promoción de lección',
}

const ROLLBACK_WINDOW_HOURS = 24

export function AutoPilotClient() {
  const [proposals, setProposals] = useState<AutoPilotProposal[] | null>(null)
  const [history, setHistory] = useState<AutoPilotRunRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // `nowMs` se setea cuando termina cada refresh (no en render) — respeta la
  // regla `react-hooks/purity` de React 19: nada de Date.now() durante render.
  const [nowMs, setNowMs] = useState<number>(0)
  const [isPending, startTransition] = useTransition()
  const [isMutating, startMutation] = useTransition()

  const refresh = useCallback(() => {
    setError(null)
    startTransition(async () => {
      try {
        const [p, h] = await Promise.all([
          listProposals(),
          listAutoPilotHistory(),
        ])
        setProposals(p.proposals)
        setHistory(h)
        setNowMs(Date.now())
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al cargar')
      }
    })
  }, [])

  useEffect(() => {
    // Defer la primera carga al siguiente tick para no disparar setState
    // sincrono dentro del effect (react-hooks/set-state-in-effect).
    const id = setTimeout(() => {
      refresh()
    }, 0)
    return () => clearTimeout(id)
  }, [refresh])

  const onApply = (proposalId: string) => {
    setError(null)
    startMutation(async () => {
      try {
        await applyProposalById(proposalId)
        setConfirmingId(null)
        refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al aplicar')
      }
    })
  }

  const onRollback = (runId: string) => {
    setError(null)
    startMutation(async () => {
      try {
        await rollbackRun(runId)
        refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al revertir')
      }
    })
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-indigo-200 flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Brain Auto-Pilot
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Propuestas de optimización aplicables con 1-click. Apply + Rollback
            transaccionales con ventana de reversión de {ROLLBACK_WINDOW_HOURS}h.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={clsx('h-3.5 w-3.5', isPending && 'animate-spin')} />
          Refrescar
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {proposals === null && !error && <SkeletonList />}

      {proposals !== null && proposals.length === 0 && (
        <div className="rounded-lg border border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
          Sin oportunidades detectadas — el portfolio está balanceado.
        </div>
      )}

      {proposals !== null && proposals.length > 0 && (
        <ul className="flex flex-col gap-3">
          {proposals.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-border bg-card/60 p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className={clsx(
                    'shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase',
                    SEV_TONE[p.severity],
                  )}
                >
                  {p.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide text-indigo-300/80">
                      {KIND_LABEL[p.kind] ?? p.kind}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      confianza {(p.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-foreground">
                    {p.summary}
                  </h3>
                  <button
                    type="button"
                    onClick={() => toggleExpand(p.id)}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {expandedIds.has(p.id) ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    Razonamiento
                  </button>
                  {expandedIds.has(p.id) && (
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                      {p.rationale}
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                    <PreviewBlock title="Antes" data={p.preview.before} />
                    <PreviewBlock title="Después" data={p.preview.after} highlight />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {confirmingId === p.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onApply(p.id)}
                        disabled={isMutating}
                        className="inline-flex items-center gap-1 rounded-md bg-indigo-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" />
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={isMutating}
                        className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] hover:bg-accent disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(p.id)}
                      disabled={isMutating}
                      className="inline-flex items-center gap-1 rounded-md bg-indigo-500/20 border border-indigo-500/40 px-2.5 py-1 text-[11px] font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
                    >
                      Aplicar
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-2 rounded-lg border border-border bg-card/40">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <History className="h-4 w-4 text-indigo-300" />
            Historial · últimas {history.length} runs
          </span>
          {historyOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {historyOpen && (
          <div className="border-t border-border px-4 py-3">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin runs en este workspace.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((r) => {
                  const appliedMs = Date.parse(r.appliedAt) || 0
                  const ageMs = nowMs > 0 ? nowMs - appliedMs : 0
                  const ageHours = ageMs / (60 * 60 * 1000)
                  const canRollback =
                    !r.rolledBackAt && nowMs > 0 && ageHours < ROLLBACK_WINDOW_HOURS
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/40 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {r.summary}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {KIND_LABEL[r.kind] ?? r.kind} ·{' '}
                          {r.appliedByName ?? '—'} ·{' '}
                          {new Date(r.appliedAt).toLocaleString()}
                          {r.rolledBackAt && (
                            <>
                              {' '}· revertido{' '}
                              {new Date(r.rolledBackAt).toLocaleString()}
                            </>
                          )}
                        </p>
                      </div>
                      {canRollback ? (
                        <button
                          type="button"
                          onClick={() => onRollback(r.id)}
                          disabled={isMutating}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          <Undo2 className="h-3 w-3" />
                          Revertir
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic shrink-0">
                          {r.rolledBackAt ? 'revertido' : 'ventana cerrada'}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function PreviewBlock({
  title,
  data,
  highlight,
}: {
  title: string
  data: Record<string, string | number | null>
  highlight?: boolean
}) {
  return (
    <div
      className={clsx(
        'rounded-md border px-2 py-1.5',
        highlight
          ? 'border-indigo-500/40 bg-indigo-500/10'
          : 'border-border bg-background/40',
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        {title}
      </p>
      <dl className="flex flex-col gap-0.5">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted-foreground truncate">{k}</dt>
            <dd className="font-medium text-foreground/90 truncate">
              {v === null ? '—' : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SkeletonList() {
  return (
    <ul className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-28 animate-pulse rounded-lg border border-border bg-card/40"
        />
      ))}
    </ul>
  )
}
