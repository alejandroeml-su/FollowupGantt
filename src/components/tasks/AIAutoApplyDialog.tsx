'use client'

/**
 * Wave R5 Extended · US R5E — AI Auto-Apply Dialog.
 *
 * Pasa de "te muestro la propuesta de la IA y pégala a mano" a
 * "te muestro un diff side-by-side y aplicas con un click los campos
 * que aceptes". El componente recibe el snapshot actual de la tarea +
 * una propuesta multi-campo y renderiza una tabla por campo con:
 *
 *   · Checkbox por campo (default checked).
 *   · Columna izquierda: valor actual.
 *   · Columna derecha: valor propuesto (con resaltado).
 *
 * Cuando el usuario clickea "Aplicar selección":
 *   1. Recolectamos qué campos quedaron marcados.
 *   2. Llamamos `applyTaskRefinement` en el server.
 *   3. Llamamos `onApplied()` para que el padre haga `router.refresh()`.
 *
 * Tailwind 4 dark mode: usamos `text-foreground` / `bg-card` /
 * `border-border` (CSS variables que togglean con la clase `.dark`).
 * No usamos patrones `dark:text-slate-200` salvo en el highlight
 * acentuado (que sí queremos ver distinto en ambos themes).
 */

import { useMemo, useState } from 'react'
import { applyTaskRefinement } from '@/lib/actions/task-refinement'
import type { RefinementSource } from '@/lib/ai/refinement/schemas'

/** Campos editables vía AI Auto-Apply (debe coincidir con el server). */
export type AIApplyField =
  | 'title'
  | 'description'
  | 'userStory'
  | 'scrumAttributes'
  | 'pmiAttributes'
  | 'itilAttributes'

export interface AIAutoApplyProposal {
  title?: string | null
  description?: string | null
  userStory?: {
    asA?: string | null
    iWant?: string | null
    soThat?: string | null
    criteria?: Array<{ id?: string; text: string; done?: boolean }>
  } | null
  scrumAttributes?: Record<string, unknown> | null
  pmiAttributes?: Record<string, unknown> | null
  itilAttributes?: Record<string, unknown> | null
}

export interface AIAutoApplyCurrentTask {
  title?: string | null
  description?: string | null
  userStory?: {
    asA?: string | null
    iWant?: string | null
    soThat?: string | null
    criteria?: Array<{ id?: string; text: string; done?: boolean }>
  } | null
  scrumAttributes?: Record<string, unknown> | null
  pmiAttributes?: Record<string, unknown> | null
  itilAttributes?: Record<string, unknown> | null
}

export interface AIAutoApplyDialogProps {
  open: boolean
  onClose: () => void
  taskId: string
  /** Snapshot actual de los campos editables. */
  currentTask: AIAutoApplyCurrentTask
  /** Propuesta de la IA. Solo aparecen en el diff los campos definidos. */
  proposed: AIAutoApplyProposal
  /** Origen de la propuesta para auditoría y label en el header. */
  source: RefinementSource
  /** Razón corta cuando caemos a heurística (sin API key, error, etc.). */
  fallbackReason?: string | null
  /** Callback tras aplicar exitosamente — el padre suele `router.refresh()`. */
  onApplied?: (result: { applied: string[] }) => void
  /** Callback para errores (tostable por el padre). */
  onError?: (msg: string) => void
}

const SOURCE_LABELS: Record<RefinementSource, string> = {
  llm: 'Generado con IA · Anthropic',
  heuristic: 'Heurística (LLM disabled)',
}

const FIELD_LABELS: Record<AIApplyField, string> = {
  title: 'Título',
  description: 'Descripción',
  userStory: 'Historia de usuario',
  scrumAttributes: 'Atributos Scrum',
  pmiAttributes: 'Atributos PMI',
  itilAttributes: 'Atributos ITIL',
}

/**
 * Determina qué campos están "presentes" en la propuesta (no
 * `undefined`/`null`) y por tanto deben aparecer en el diff. Si la IA
 * no propuso un campo no lo mostramos — evita confusión y ruido.
 */
function fieldsFromProposal(proposal: AIAutoApplyProposal): AIApplyField[] {
  const out: AIApplyField[] = []
  if (typeof proposal.title === 'string' && proposal.title.trim().length > 0) {
    out.push('title')
  }
  if (typeof proposal.description === 'string') out.push('description')
  if (proposal.userStory) out.push('userStory')
  if (proposal.scrumAttributes) out.push('scrumAttributes')
  if (proposal.pmiAttributes) out.push('pmiAttributes')
  if (proposal.itilAttributes) out.push('itilAttributes')
  return out
}

/** Formato JSON compacto para mostrar atributos por metodología en el diff. */
function prettyJSON(value: unknown): string {
  if (value === null || value === undefined) return '(vacío)'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Render del valor "actual" o "propuesto" por campo. */
function FieldDiffCell({
  field,
  value,
  variant,
}: {
  field: AIApplyField
  value: unknown
  variant: 'current' | 'proposed'
}): React.JSX.Element {
  const base =
    variant === 'current'
      ? 'text-foreground bg-secondary/40 border-border'
      : 'text-foreground bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800/60'

  if (field === 'title') {
    const v = typeof value === 'string' ? value : ''
    return (
      <div
        className={`text-sm whitespace-pre-wrap border rounded p-2 min-h-[40px] ${base}`}
        data-testid={`ai-apply-${variant}-${field}`}
      >
        {v || '(vacío)'}
      </div>
    )
  }

  if (field === 'description') {
    const v = typeof value === 'string' ? value : ''
    return (
      <div
        className={`text-sm whitespace-pre-wrap border rounded p-2 min-h-[80px] max-h-[200px] overflow-auto ${base}`}
        data-testid={`ai-apply-${variant}-${field}`}
      >
        {v || '(vacío)'}
      </div>
    )
  }

  if (field === 'userStory') {
    const us = (value ?? null) as AIAutoApplyProposal['userStory']
    if (!us) {
      return (
        <div
          className={`text-sm text-muted-foreground border rounded p-2 min-h-[60px] ${base}`}
          data-testid={`ai-apply-${variant}-${field}`}
        >
          (sin historia)
        </div>
      )
    }
    return (
      <div
        className={`text-sm border rounded p-2 min-h-[60px] space-y-1 ${base}`}
        data-testid={`ai-apply-${variant}-${field}`}
      >
        <p>
          <strong>Como:</strong> {us.asA || '(vacío)'}
        </p>
        <p>
          <strong>Quiero:</strong> {us.iWant || '(vacío)'}
        </p>
        <p>
          <strong>Para:</strong> {us.soThat || '(vacío)'}
        </p>
        {Array.isArray(us.criteria) && us.criteria.length > 0 && (
          <ul className="list-disc ml-4 mt-1 text-xs">
            {us.criteria.map((c, i) => (
              <li key={c.id ?? i}>{c.text}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // scrum/pmi/itil attributes — JSON pretty.
  return (
    <pre
      className={`text-xs whitespace-pre-wrap border rounded p-2 min-h-[60px] max-h-[200px] overflow-auto font-mono ${base}`}
      data-testid={`ai-apply-${variant}-${field}`}
    >
      {prettyJSON(value)}
    </pre>
  )
}

/**
 * Wrapper exterior: garantiza que el estado se inicialice una sola vez
 * por dialog abierto (igual patrón que `AISuggestionDialog`). El key
 * incluye `taskId` + lista de campos para remountar si cambia el set.
 */
export function AIAutoApplyDialog(
  props: AIAutoApplyDialogProps,
): React.JSX.Element | null {
  if (!props.open) return null
  const fields = fieldsFromProposal(props.proposed)
  if (fields.length === 0) {
    // No hay nada que aplicar — render mínimo con CTA cerrar.
    return (
      <div
        className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-card text-foreground rounded-lg shadow-xl max-w-md w-full p-4 space-y-3 border border-border">
          <h2 className="text-base font-semibold">Auto-Apply</h2>
          <p className="text-sm text-muted-foreground">
            La IA no propuso cambios aplicables en ningún campo soportado.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={props.onClose}
              className="px-3 py-1 text-sm rounded border border-border bg-card hover:bg-secondary"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    )
  }
  const key = `${props.taskId}::${fields.join(',')}`
  return <DialogBody key={key} {...props} fields={fields} />
}

interface DialogBodyProps extends AIAutoApplyDialogProps {
  fields: AIApplyField[]
}

function DialogBody({
  onClose,
  taskId,
  currentTask,
  proposed,
  source,
  fallbackReason,
  onApplied,
  onError,
  fields,
}: DialogBodyProps): React.JSX.Element {
  // Por defecto todos los campos propuestos arrancan aceptados (checked).
  const [accepted, setAccepted] = useState<Set<AIApplyField>>(
    () => new Set(fields),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const acceptedList = useMemo(() => Array.from(accepted), [accepted])

  function toggle(field: AIApplyField) {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  async function handleApply() {
    if (acceptedList.length === 0) {
      setError('Selecciona al menos un campo para aplicar.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await applyTaskRefinement({
        taskId,
        accepted: acceptedList,
        proposed: {
          title: typeof proposed.title === 'string' ? proposed.title : undefined,
          description:
            typeof proposed.description === 'string'
              ? proposed.description
              : undefined,
          userStory: proposed.userStory
            ? {
                asA: proposed.userStory.asA ?? '',
                iWant: proposed.userStory.iWant ?? '',
                soThat: proposed.userStory.soThat ?? '',
                criteria: Array.isArray(proposed.userStory.criteria)
                  ? proposed.userStory.criteria.map((c) => ({
                      id: c.id,
                      text: c.text,
                      done: Boolean(c.done),
                    }))
                  : undefined,
              }
            : undefined,
          scrumAttributes: proposed.scrumAttributes ?? undefined,
          pmiAttributes: proposed.pmiAttributes ?? undefined,
          itilAttributes: proposed.itilAttributes ?? undefined,
        },
        model: source,
      })
      if (!result.ok) {
        setError(result.error)
        onError?.(result.error)
        setPending(false)
        return
      }
      onApplied?.({ applied: result.applied })
      setPending(false)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      onError?.(msg)
      setPending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-auto-apply-title"
      data-testid="ai-auto-apply-dialog"
    >
      <div className="bg-card text-foreground rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-border">
        <header className="border-b border-border p-4 flex items-center justify-between">
          <div>
            <h2
              id="ai-auto-apply-title"
              className="text-lg font-semibold"
            >
              Aplicar refinements de IA
            </h2>
            <p
              className="text-xs text-muted-foreground"
              data-testid="ai-auto-apply-source"
            >
              {SOURCE_LABELS[source]}
              {fallbackReason ? ` — ${fallbackReason}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Cerrar"
          >
            X
          </button>
        </header>

        <div className="p-4 space-y-4">
          {error && (
            <div
              className="p-2 border border-rose-300 bg-rose-50 text-rose-800 rounded text-sm dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200"
              role="alert"
              data-testid="ai-auto-apply-error"
            >
              {error}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Marca los campos que quieres aplicar. Por defecto se aceptan todos.
            Los no aceptados conservan su valor actual.
          </p>

          <ul className="space-y-4" data-testid="ai-auto-apply-fields">
            {fields.map((field) => {
              const isChecked = accepted.has(field)
              const currentValue =
                field === 'title'
                  ? currentTask.title
                  : field === 'description'
                    ? currentTask.description
                    : field === 'userStory'
                      ? currentTask.userStory
                      : field === 'scrumAttributes'
                        ? currentTask.scrumAttributes
                        : field === 'pmiAttributes'
                          ? currentTask.pmiAttributes
                          : currentTask.itilAttributes
              const proposedValue =
                field === 'title'
                  ? proposed.title
                  : field === 'description'
                    ? proposed.description
                    : field === 'userStory'
                      ? proposed.userStory
                      : field === 'scrumAttributes'
                        ? proposed.scrumAttributes
                        : field === 'pmiAttributes'
                          ? proposed.pmiAttributes
                          : proposed.itilAttributes
              return (
                <li
                  key={field}
                  className="border border-border rounded p-3 bg-background"
                  data-testid={`ai-auto-apply-row-${field}`}
                >
                  <label className="flex items-center gap-2 mb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(field)}
                      data-testid={`ai-auto-apply-toggle-${field}`}
                      className="accent-emerald-600"
                    />
                    <span className="text-sm font-semibold">
                      {FIELD_LABELS[field]}
                    </span>
                    {!isChecked && (
                      <span className="text-xs text-muted-foreground">
                        (descartado — conserva valor actual)
                      </span>
                    )}
                  </label>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground mb-1">
                        Actual
                      </h3>
                      <FieldDiffCell
                        field={field}
                        value={currentValue}
                        variant="current"
                      />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
                        Propuesto
                      </h3>
                      <FieldDiffCell
                        field={field}
                        value={proposedValue}
                        variant="proposed"
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <footer className="border-t border-border p-3 flex items-center justify-between gap-2">
          <span
            className="text-xs text-muted-foreground"
            data-testid="ai-auto-apply-counter"
          >
            {acceptedList.length} de {fields.length} campos seleccionados
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-sm rounded border border-border bg-card hover:bg-secondary"
              data-testid="ai-auto-apply-cancel"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={pending || acceptedList.length === 0}
              className="px-3 py-1 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              data-testid="ai-auto-apply-submit"
            >
              {pending
                ? 'Aplicando...'
                : `Aplicar ${acceptedList.length} ${
                    acceptedList.length === 1 ? 'campo' : 'campos'
                  }`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
