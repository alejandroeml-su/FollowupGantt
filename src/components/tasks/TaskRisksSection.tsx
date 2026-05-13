'use client'

/**
 * Sección "Riesgos" dentro del TaskDrawer (Wave 2026-05-13).
 *
 * Edwin pidió poder visualizar, agregar y mitigar riesgos directamente
 * desde la tarea. El componente lista los `Risk` vinculados vía
 * `Risk.taskId`, permite crear uno nuevo con probability/impact (matriz
 * 5×5 PMBOK) y cambiar el estado (OPEN → MITIGATING → CLOSED) inline.
 *
 * Patrón mismo que `TaskInsightsSection` / `TaskAuditHistorySection`:
 * collapsible con lazy load on first open, `useTransition` para
 * acciones de mutación.
 */

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  Shield,
  Trash2,
} from 'lucide-react'
import {
  getRisksForTask,
  createRisk,
  updateRisk,
  deleteRisk,
} from '@/lib/actions/risks'
import type { SerializedRisk } from '@/lib/risks/types'

interface Props {
  taskId: string
  projectId?: string | null
  defaultOpen?: boolean
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Abierto',
  MITIGATING: 'Mitigando',
  ACCEPTED: 'Aceptado',
  CLOSED: 'Cerrado',
}

const STATUS_TONE: Record<string, string> = {
  OPEN: 'bg-rose-100 text-rose-800 border-rose-200',
  MITIGATING: 'bg-amber-100 text-amber-800 border-amber-200',
  ACCEPTED: 'bg-blue-100 text-blue-800 border-blue-200',
  CLOSED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
}

function severityTone(prob: number, impact: number): string {
  const score = (prob ?? 0) * (impact ?? 0)
  if (score >= 16) return 'text-rose-600'
  if (score >= 9) return 'text-amber-600'
  if (score >= 4) return 'text-yellow-600'
  return 'text-muted-foreground'
}

export function TaskRisksSection({
  taskId,
  projectId,
  defaultOpen = true,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [risks, setRisks] = useState<SerializedRisk[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  // Form local para crear un nuevo riesgo.
  const [draftTitle, setDraftTitle] = useState('')
  const [draftProbability, setDraftProbability] = useState(3)
  const [draftImpact, setDraftImpact] = useState(3)
  const [draftMitigation, setDraftMitigation] = useState('')

  const reload = useCallback(async () => {
    try {
      const list = await getRisksForTask(taskId)
      setRisks(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoaded(true)
    }
  }, [taskId])

  useEffect(() => {
    if (!open || loaded) return
    void reload()
  }, [open, loaded, reload])

  // Cuando el usuario aplica una sugerencia de IA con risks, el server crea
  // las filas Risk; recargamos al recibir el evento global.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onRefresh(ev: Event) {
      const detail = (ev as CustomEvent).detail as { taskId?: string } | null
      if (!detail || detail.taskId === taskId) {
        setLoaded(false)
      }
    }
    window.addEventListener('task-risks:refresh', onRefresh)
    return () => window.removeEventListener('task-risks:refresh', onRefresh)
  }, [taskId])

  function resetDraft() {
    setDraftTitle('')
    setDraftProbability(3)
    setDraftImpact(3)
    setDraftMitigation('')
  }

  function handleAdd() {
    if (!projectId) {
      setError('La tarea no tiene proyecto asociado.')
      return
    }
    if (!draftTitle.trim()) {
      setError('El título del riesgo es obligatorio.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await createRisk({
          projectId,
          taskId,
          title: draftTitle.trim(),
          probability: draftProbability,
          impact: draftImpact,
          status: 'OPEN',
          mitigation: draftMitigation.trim() || null,
        })
        resetDraft()
        setAdding(false)
        await reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  function handleMitigate(risk: SerializedRisk) {
    setPendingId(risk.id)
    startTransition(async () => {
      try {
        // OPEN → MITIGATING → CLOSED, ciclo simple.
        const next: SerializedRisk['status'] =
          risk.status === 'OPEN'
            ? 'MITIGATING'
            : risk.status === 'MITIGATING'
              ? 'CLOSED'
              : 'OPEN'
        await updateRisk(risk.id, { status: next })
        await reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setPendingId(null)
      }
    })
  }

  function handleDelete(risk: SerializedRisk) {
    if (!confirm(`¿Eliminar el riesgo "${risk.title}"?`)) return
    setPendingId(risk.id)
    startTransition(async () => {
      try {
        await deleteRisk(risk.id)
        await reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setPendingId(null)
      }
    })
  }

  return (
    <section className="space-y-2" data-testid="task-risks-section">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md py-1 text-left text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-secondary/40"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Shield className="h-3.5 w-3.5 text-amber-500" />
        <span>Riesgos</span>
        {loaded && (
          <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground">
            {risks.length}
          </span>
        )}
      </button>

      {open && (
        <div className="space-y-2">
          {error && (
            <div className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs text-rose-800">
              {error}
            </div>
          )}

          {!loaded ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">Cargando…</p>
          ) : risks.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Sin riesgos registrados para esta tarea.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {risks.map((r) => {
                const severity = (r.probability ?? 0) * (r.impact ?? 0)
                return (
                  <li
                    key={r.id}
                    className="rounded-md border border-border bg-card px-3 py-2"
                    data-testid={`task-risk-${r.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        className={`mt-0.5 h-3.5 w-3.5 ${severityTone(
                          r.probability ?? 0,
                          r.impact ?? 0,
                        )}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {r.title}
                          </span>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              STATUS_TONE[r.status] ?? STATUS_TONE.OPEN
                            }`}
                          >
                            {STATUS_LABELS[r.status] ?? r.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            P{r.probability}·I{r.impact} · sev {severity}
                          </span>
                        </div>
                        {r.description && (
                          <p className="mt-1 text-xs text-foreground/80 whitespace-pre-wrap">
                            {r.description}
                          </p>
                        )}
                        {r.mitigation && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            <span className="font-semibold">Mitigación:</span>{' '}
                            {r.mitigation}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMitigate(r)}
                          disabled={pendingId === r.id}
                          className="rounded px-2 py-1 text-[10px] font-medium text-foreground/80 hover:bg-secondary disabled:opacity-50"
                          title="Avanzar estado (Abierto → Mitigando → Cerrado)"
                        >
                          ▸ Estado
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r)}
                          disabled={pendingId === r.id}
                          aria-label={`Eliminar riesgo ${r.title}`}
                          className="rounded p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-secondary/60"
            >
              <Plus className="h-3 w-3" />
              Agregar riesgo
            </button>
          ) : (
            <div className="space-y-2 rounded-md border border-border bg-card p-2">
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Título del riesgo"
                className="w-full rounded border border-border bg-input px-2 py-1 text-sm text-input-foreground focus:border-primary focus:outline-none"
                autoFocus
              />
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1">
                  <span className="text-muted-foreground">Prob.</span>
                  <select
                    value={draftProbability}
                    onChange={(e) =>
                      setDraftProbability(Number(e.target.value))
                    }
                    className="rounded border border-border bg-input px-1 py-0.5 text-xs"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-muted-foreground">Impacto</span>
                  <select
                    value={draftImpact}
                    onChange={(e) => setDraftImpact(Number(e.target.value))}
                    className="rounded border border-border bg-input px-1 py-0.5 text-xs"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-[10px] text-muted-foreground">
                  Severidad: {draftProbability * draftImpact}
                </span>
              </div>
              <textarea
                value={draftMitigation}
                onChange={(e) => setDraftMitigation(e.target.value)}
                placeholder="Plan de mitigación (opcional)"
                rows={2}
                className="w-full rounded border border-border bg-input px-2 py-1 text-xs text-input-foreground focus:border-primary focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false)
                    resetDraft()
                  }}
                  className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Guardar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default TaskRisksSection
