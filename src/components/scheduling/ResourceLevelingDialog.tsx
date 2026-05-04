'use client'

import { useState, useTransition } from 'react'
import { ArrowRight, Calculator, X, CheckCircle2, Loader2 } from 'lucide-react'
import {
  applyLevelingPlan,
  computeLevelingPlan,
  type SerializableLevelingChange,
  type SerializableLevelingPlan,
} from '@/lib/actions/leveling'

interface Props {
  projectId: string
  /** Callback opcional al aplicar el plan (refresh externo). */
  onApplied?: () => void
}

const REASON_LABELS: Record<SerializableLevelingChange['reason'], string> = {
  OVER_CAPACITY: 'Sobre capacidad',
  NO_SLACK: 'Sin holgura',
  HARD_DEADLINE: 'Bloqueado por vencimiento',
  CRITICAL: 'Tarea crítica',
  NO_ASSIGNEE: 'Sin asignado',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es', {
    day: '2-digit',
    month: 'short',
  })
}

/**
 * Diálogo modal: calcula y aplica un plan de nivelación de recursos.
 *
 * Estados:
 *   - idle:     muestra botón "Calcular leveling"
 *   - computing/ready: tabla con cambios propuestos + "Aplicar plan"
 *   - applying: spinner mientras la transaction corre
 *   - applied:  banner de éxito con count de updates
 *
 * Errores se muestran inline (banner rojo) usando el código tipado del
 * server action ([INVALID_INPUT], [NO_VIOLATIONS], [CYCLE_DETECTED],
 * [FORBIDDEN]).
 */
export function ResourceLevelingDialog({ projectId, onApplied }: Props) {
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<SerializableLevelingPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleOpen() {
    setOpen(true)
    setError(null)
    setAppliedCount(null)
    startTransition(async () => {
      try {
        const result = await computeLevelingPlan(projectId)
        setPlan(result)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error desconocido'
        setError(msg)
      }
    })
  }

  function handleClose() {
    setOpen(false)
    setPlan(null)
    setError(null)
    setAppliedCount(null)
  }

  function handleApply() {
    if (!plan) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await applyLevelingPlan({
          projectId,
          changes: plan.changes.map((c) => ({
            taskId: c.taskId,
            proposedStart: c.proposedStart,
            proposedEnd: c.proposedEnd,
            deltaDays: c.deltaDays,
          })),
        })
        setAppliedCount(result.updated)
        onApplied?.()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error desconocido'
        setError(msg)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600"
        data-testid="open-leveling-dialog"
      >
        <Calculator className="h-4 w-4" />
        Calcular leveling
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Nivelación de recursos"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={handleClose}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="leveling-dialog"
          >
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Nivelación de recursos
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Plan greedy basado en capacidad diaria y holgura disponible.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-auto px-6 py-4">
              {error && (
                <div
                  className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300"
                  data-testid="leveling-error"
                >
                  {error}
                </div>
              )}

              {appliedCount !== null && (
                <div
                  className="mb-4 flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300"
                  data-testid="leveling-success"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Plan aplicado: {appliedCount} tarea(s) actualizada(s).
                </div>
              )}

              {isPending && !plan && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Calculando plan…
                </div>
              )}

              {plan && (
                <PlanTable plan={plan} />
              )}
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
              <span className="text-xs text-muted-foreground">
                {plan
                  ? `${plan.changes.length} cambios · ${plan.unresolved.length} no resueltos · ${plan.overloadedDayCount} días-pico`
                  : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground hover:bg-secondary/80"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={
                    !plan || plan.changes.length === 0 || isPending || appliedCount !== null
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="apply-leveling-plan"
                >
                  {isPending && plan ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Aplicando…
                    </>
                  ) : (
                    'Aplicar plan'
                  )}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

function PlanTable({ plan }: { plan: SerializableLevelingPlan }) {
  if (plan.changes.length === 0 && plan.unresolved.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
        Sin sobreasignaciones detectadas. Las cargas están dentro de capacidad.
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {plan.changes.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tarea</th>
                <th className="px-3 py-2 font-medium">Recurso</th>
                <th className="px-3 py-2 font-medium">Inicio</th>
                <th className="px-3 py-2 font-medium">→</th>
                <th className="px-3 py-2 font-medium">Propuesto</th>
                <th className="px-3 py-2 text-right font-medium">Δ días</th>
                <th className="px-3 py-2 font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {plan.changes.map((c) => (
                <tr key={c.taskId} className="text-foreground">
                  <td className="px-3 py-2 font-medium">{c.taskTitle}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.assigneeName ?? c.assigneeId}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {fmtDate(c.originalStart)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <ArrowRight className="h-3 w-3" />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {fmtDate(c.proposedStart)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-indigo-300">
                      +{c.deltaDays}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {REASON_LABELS[c.reason]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan.unresolved.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">
            Conflictos sin resolver ({plan.unresolved.length})
          </p>
          <p className="mt-1 text-xs text-amber-200/70">
            Estas tareas no pudieron moverse automáticamente:
          </p>
          <ul className="mt-2 space-y-1 text-xs text-foreground">
            {plan.unresolved.map((u) => (
              <li key={u.taskId} className="flex items-center justify-between">
                <span>{u.taskTitle}</span>
                <span className="text-amber-200/80">
                  {REASON_LABELS[u.reason]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
