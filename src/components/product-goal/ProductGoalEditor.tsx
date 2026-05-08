'use client'

/**
 * Wave P11-Scrum (HU-11.1) — Editor del Product Goal a nivel proyecto.
 *
 * @UIUX spec:
 *   - Statement principal con contador 280 chars (Twitter-like, mantiene
 *     la disciplina del PO de articular el goal de forma compacta).
 *   - Lista editable de success metrics (chips removibles + input add).
 *   - Target date opcional con date picker.
 *   - "Última revisión PO" como timestamp visible (transparency Scrum).
 *   - Botón "Marcar revisado" sin cambiar contenido (touchProductGoalReview).
 */

import { useState, useTransition } from 'react'
import { Target, Plus, X as CloseIcon, Calendar, Sparkles, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  setProductGoal,
  touchProductGoalReview,
} from '@/lib/actions/product-goal'
import {
  isProductGoalDefined,
  type ProductGoal,
} from '@/lib/product-goal/types'
import { toast } from '@/components/interactions/Toaster'

const STATEMENT_MAX = 280

type Props = {
  projectId: string
  projectName: string
  initial: ProductGoal
}

export function ProductGoalEditor({ projectId, projectName, initial }: Props) {
  const [statement, setStatement] = useState(initial.statement)
  const [metrics, setMetrics] = useState<string[]>(initial.successMetrics)
  const [draftMetric, setDraftMetric] = useState('')
  const [targetDate, setTargetDate] = useState(initial.targetDate ?? '')
  const [lastReviewedAt, setLastReviewedAt] = useState(initial.lastReviewedAt)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  // Sync con prop si cambia (revalidatePath del server).
  // Patrón prevValue (sin useEffect) para cumplir react-hooks/set-state-in-effect.
  const [prevInitial, setPrevInitial] = useState(initial)
  if (
    prevInitial.statement !== initial.statement ||
    prevInitial.lastReviewedAt !== initial.lastReviewedAt
  ) {
    setPrevInitial(initial)
    setStatement(initial.statement)
    setMetrics(initial.successMetrics)
    setTargetDate(initial.targetDate ?? '')
    setLastReviewedAt(initial.lastReviewedAt)
  }

  const charsLeft = STATEMENT_MAX - statement.length
  const isDefined = isProductGoalDefined(initial)
  const hasChanges =
    statement !== initial.statement ||
    JSON.stringify(metrics) !== JSON.stringify(initial.successMetrics) ||
    (targetDate || null) !== initial.targetDate

  const handleAddMetric = () => {
    const m = draftMetric.trim()
    if (!m) return
    if (metrics.length >= 10) {
      toast.error('Máximo 10 métricas — consolida las más importantes')
      return
    }
    setMetrics((prev) => [...prev, m])
    setDraftMetric('')
  }

  const handleRemoveMetric = (idx: number) => {
    setMetrics((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = () => {
    if (!statement.trim()) {
      toast.error('El statement del Product Goal es requerido')
      return
    }
    startTransition(async () => {
      try {
        const next = await setProductGoal({
          projectId,
          statement: statement.trim(),
          successMetrics: metrics,
          targetDate: targetDate || null,
        })
        setLastReviewedAt(next.lastReviewedAt)
        toast.success('Product Goal guardado')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  const handleTouchReview = () => {
    startTransition(async () => {
      try {
        const next = await touchProductGoalReview(projectId)
        setLastReviewedAt(next.lastReviewedAt)
        toast.success('Marcado como revisado por el PO')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <header className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5">
        <div className="flex items-start gap-3">
          <Target className="h-6 w-6 shrink-0 text-indigo-300" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-foreground">
              Product Goal · {projectName}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Scrum Guide 2020 · El Product Goal es un commitment del Product
              Backlog que describe el estado futuro deseado del producto. Es
              referencia del Scrum Team para horizontes mayores a un sprint.
              <strong className="text-foreground/90"> El Product Owner es responsable.</strong>
            </p>
            {lastReviewedAt && (
              <p className="mt-2 text-[10px] text-muted-foreground">
                Última revisión PO:{' '}
                <time dateTime={lastReviewedAt}>
                  {new Date(lastReviewedAt).toLocaleString('es-MX')}
                </time>
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Statement */}
      <section>
        <label
          htmlFor="pg-statement"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Statement <span className="text-rose-400">*</span>
        </label>
        <textarea
          id="pg-statement"
          value={statement}
          onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
          placeholder="Ej. Convertirnos en la plataforma de gestión de proyectos PMI+Agile más adoptada de la región Avante, con 100 equipos activos al cierre del año fiscal."
          rows={3}
          className="mt-1.5 w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            🎯 Articula el &quot;para qué&quot; del Product Backlog. Imperativo, medible
            y aspiracional.
          </span>
          <span
            className={
              charsLeft < 30
                ? charsLeft < 0
                  ? 'text-rose-400 font-semibold'
                  : 'text-amber-400'
                : ''
            }
          >
            {charsLeft} chars
          </span>
        </div>
      </section>

      {/* Success metrics */}
      <section>
        <div className="flex items-baseline justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cómo mediremos el éxito
          </label>
          <span className="text-[10px] text-muted-foreground">
            {metrics.length} / 10
          </span>
        </div>

        {metrics.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {metrics.map((m, i) => (
              <li
                key={`${m}-${i}`}
                className="flex items-center gap-2 rounded border border-border bg-input/40 px-2.5 py-1.5"
              >
                <Sparkles className="h-3 w-3 shrink-0 text-indigo-400" />
                <span className="flex-1 text-sm text-foreground">{m}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveMetric(i)}
                  aria-label={`Quitar métrica ${m}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-rose-400"
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {metrics.length < 10 && (
          <div className="mt-2 flex items-center gap-1.5 rounded border border-dashed border-border bg-input/20 px-2.5 py-1.5">
            <Plus
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              type="text"
              value={draftMetric}
              onChange={(e) => setDraftMetric(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddMetric()
                }
              }}
              placeholder="Ej. NPS ≥ 50 al Q2 · Adopción 100 equipos · …"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddMetric}
              disabled={!draftMetric.trim()}
              className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40"
            >
              + Agregar
            </button>
          </div>
        )}
      </section>

      {/* Target date */}
      <section>
        <label
          htmlFor="pg-target"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Fecha objetivo (opcional)
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <input
            id="pg-target"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {targetDate && (
            <button
              type="button"
              onClick={() => setTargetDate('')}
              className="text-[10px] text-muted-foreground hover:text-rose-400"
            >
              Quitar
            </button>
          )}
        </div>
      </section>

      {/* Footer actions */}
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {isDefined && (
          <button
            type="button"
            onClick={handleTouchReview}
            disabled={isPending || hasChanges}
            title={hasChanges ? 'Guarda los cambios primero' : 'Marca como revisado por el PO sin cambiar contenido'}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80 disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" /> Marcar revisado
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !statement.trim() || !hasChanges}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Target className="h-3.5 w-3.5" />
          {isPending
            ? 'Guardando…'
            : isDefined
              ? 'Actualizar Product Goal'
              : 'Definir Product Goal'}
        </button>
      </footer>
    </div>
  )
}
