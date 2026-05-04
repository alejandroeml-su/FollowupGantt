'use client'

/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — Dialog de preview + aplicar.
 *
 * Modal genérico que muestra una sugerencia (cualquiera de los 5
 * tipos) con preview side-by-side: estado actual vs sugerido. Tres
 * botones:
 *   - "Aceptar y aplicar" → llama `applyRefinementAction` con el
 *     payload pre-rellenado.
 *   - "Editar antes de aplicar" → permite editar campos antes de
 *     aplicar (edición textarea o lista mutable).
 *   - "Descartar" → cierra sin tocar nada.
 *
 * Source label: "Generado con IA · Anthropic" o
 * "Heurística (LLM disabled)".
 *
 * El componente NO conoce los detalles de cada acción: recibe un
 * `kind` discriminado y datos genéricos. Todo el optimistic UI
 * (rollback en error) lo maneja el padre vía callback `onApplied`.
 */

import { useMemo, useState } from 'react'
import { applyRefinementAction } from '@/lib/actions/task-refinement'
import type {
  ImproveDescriptionResult,
  SuggestChecklistResult,
  SuggestTagsResult,
  DetectDuplicatesResult,
  RefineCategorizationResult,
  RefinementSource,
} from '@/lib/ai/refinement/schemas'

export type RefinementKind =
  | 'description'
  | 'checklist'
  | 'tags'
  | 'duplicates'
  | 'categorization'

export type SuggestionPayload =
  | { kind: 'description'; data: ImproveDescriptionResult }
  | { kind: 'checklist'; data: SuggestChecklistResult }
  | { kind: 'tags'; data: SuggestTagsResult }
  | { kind: 'duplicates'; data: DetectDuplicatesResult }
  | { kind: 'categorization'; data: RefineCategorizationResult }

export interface AISuggestionDialogProps {
  open: boolean
  onClose: () => void
  taskId: string
  /** Estado actual de la task (para preview "actual vs sugerido"). */
  currentTask: {
    title: string
    description?: string | null
    type?: string | null
    priority?: string | null
    tags?: string[]
  }
  suggestion: SuggestionPayload | null
  source: RefinementSource
  fallbackReason?: string | null
  /** Callback tras aplicar exitosamente. Permite rollback en error. */
  onApplied?: (result: { applied: string[] }) => void
  /** Callback para errores (para que el padre pueda tostarlos). */
  onError?: (msg: string) => void
}

const SOURCE_LABELS: Record<RefinementSource, string> = {
  llm: 'Generado con IA · Anthropic',
  heuristic: 'Heurística (LLM disabled)',
}

/**
 * Wrapper exterior. Si no hay sugerencia o el dialog está cerrado,
 * devuelve null. Cuando hay sugerencia, monta `<DialogBody>` con un
 * `key` derivado de la identidad de la sugerencia → cualquier cambio
 * de tipo de sugerencia desmonta/remonta el body, lo que permite que
 * `useState` inicialice los drafts desde props sin recurrir a un
 * `useEffect → setState` (regla `react-hooks/set-state-in-effect`).
 */
export function AISuggestionDialog(
  props: AISuggestionDialogProps,
): React.JSX.Element | null {
  if (!props.open || !props.suggestion) return null
  const dialogKey = `${props.suggestion.kind}::${props.taskId}`
  return <DialogBody key={dialogKey} {...props} suggestion={props.suggestion} />
}

interface DialogBodyProps extends AISuggestionDialogProps {
  suggestion: SuggestionPayload
}

function DialogBody({
  onClose,
  taskId,
  currentTask,
  suggestion,
  source,
  fallbackReason,
  onApplied,
  onError,
}: DialogBodyProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Drafts inicializados desde la sugerencia. El `key` del wrapper
  // garantiza que esta inicialización ocurra una sola vez por
  // sugerencia (mount → useState first-arg). No usamos useEffect.
  const [draftDescription, setDraftDescription] = useState<string>(
    suggestion.kind === 'description' ? suggestion.data.improvedDescription : '',
  )
  const [draftChecklist, setDraftChecklist] = useState<
    SuggestChecklistResult['items']
  >(suggestion.kind === 'checklist' ? suggestion.data.items : [])
  const [draftTags, setDraftTags] = useState<string[]>(
    suggestion.kind === 'tags' ? suggestion.data.tags.map((t) => t.tag) : [],
  )
  const [draftType, setDraftType] = useState<string>(
    suggestion.kind === 'categorization' ? suggestion.data.suggestedType : '',
  )
  const [draftPriority, setDraftPriority] = useState<string>(
    suggestion.kind === 'categorization' ? suggestion.data.suggestedPriority : '',
  )
  const [duplicatesAction, setDuplicatesAction] = useState<{
    canonicalId: string | null
  }>({
    canonicalId:
      suggestion.kind === 'duplicates'
        ? suggestion.data.candidates[0]?.taskId ?? null
        : null,
  })

  const title = useMemo(() => {
    switch (suggestion.kind) {
      case 'description':
        return 'Sugerencia: mejorar descripción'
      case 'checklist':
        return 'Sugerencia: checklist'
      case 'tags':
        return 'Sugerencia: tags'
      case 'duplicates':
        return 'Posibles duplicados'
      case 'categorization':
        return 'Sugerencia: categoría'
    }
  }, [suggestion])

  async function handleApply() {
    setPending(true)
    setError(null)
    try {
      let payload: Record<string, unknown> = {}
      let kindForServer: 'description' | 'checklist' | 'tags' | 'categorization' | 'merge_duplicate' = 'description'

      if (suggestion.kind === 'description') {
        kindForServer = 'description'
        payload = { description: editing ? draftDescription : suggestion.data.improvedDescription }
      } else if (suggestion.kind === 'checklist') {
        kindForServer = 'checklist'
        payload = { items: editing ? draftChecklist : suggestion.data.items }
      } else if (suggestion.kind === 'tags') {
        kindForServer = 'tags'
        payload = {
          tags: editing ? draftTags : suggestion.data.tags.map((t) => t.tag),
          replace: false,
        }
      } else if (suggestion.kind === 'categorization') {
        kindForServer = 'categorization'
        payload = {
          type: editing ? draftType : suggestion.data.suggestedType,
          priority: editing ? draftPriority : suggestion.data.suggestedPriority,
        }
      } else if (suggestion.kind === 'duplicates') {
        kindForServer = 'merge_duplicate'
        if (!duplicatesAction.canonicalId) {
          throw new Error('Selecciona la tarea canónica para hacer merge')
        }
        payload = { canonicalId: duplicatesAction.canonicalId }
      }

      const result = await applyRefinementAction({
        taskId,
        kind: kindForServer,
        payload,
      })
      if (!result.ok) {
        const msg = result.error || 'No se pudo aplicar la sugerencia'
        setError(msg)
        onError?.(msg)
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
      aria-labelledby="ai-suggestion-dialog-title"
      data-testid="ai-suggestion-dialog"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <header className="border-b border-gray-200 p-4 flex items-center justify-between">
          <div>
            <h2
              id="ai-suggestion-dialog-title"
              className="text-lg font-semibold"
            >
              {title}
            </h2>
            <p
              className="text-xs text-gray-500"
              data-testid="ai-suggestion-source"
            >
              {SOURCE_LABELS[source]}
              {fallbackReason ? ` — ${fallbackReason}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>

        <div className="p-4 space-y-4">
          {error && (
            <div
              className="p-2 border border-red-300 bg-red-50 text-red-800 rounded text-sm"
              role="alert"
              data-testid="ai-suggestion-error"
            >
              {error}
            </div>
          )}

          {/* DESCRIPTION */}
          {suggestion.kind === 'description' && (
            <div className="grid md:grid-cols-2 gap-4">
              <section aria-label="Descripción actual">
                <h3 className="text-sm font-semibold mb-2 text-gray-700">
                  Actual
                </h3>
                <div
                  className="text-sm text-gray-800 whitespace-pre-wrap border border-gray-200 rounded p-2 bg-gray-50 min-h-[120px]"
                  data-testid="ai-current-description"
                >
                  {currentTask.description || '(vacía)'}
                </div>
              </section>
              <section aria-label="Descripción sugerida">
                <h3 className="text-sm font-semibold mb-2 text-blue-700">
                  Sugerida
                </h3>
                {editing ? (
                  <textarea
                    className="w-full border border-blue-300 rounded p-2 text-sm min-h-[120px]"
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    data-testid="ai-suggested-description-edit"
                  />
                ) : (
                  <div
                    className="text-sm text-gray-800 whitespace-pre-wrap border border-blue-200 rounded p-2 bg-blue-50 min-h-[120px]"
                    data-testid="ai-suggested-description"
                  >
                    {suggestion.data.improvedDescription}
                  </div>
                )}
                {suggestion.data.acceptanceCriteria.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-gray-700">
                      Criterios de aceptación sugeridos
                    </h4>
                    <ul className="text-xs text-gray-700 list-disc ml-4 mt-1">
                      {suggestion.data.acceptanceCriteria.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {suggestion.data.risks.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-amber-700">
                      Riesgos identificados
                    </h4>
                    <ul className="text-xs text-amber-800 list-disc ml-4 mt-1">
                      {suggestion.data.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* CHECKLIST */}
          {suggestion.kind === 'checklist' && (
            <section aria-label="Checklist sugerida">
              <p className="text-xs text-gray-500 mb-2">
                Se anexarán como bloque al final de la descripción.
              </p>
              <ul
                className="space-y-1 text-sm"
                data-testid="ai-suggested-checklist"
              >
                {(editing ? draftChecklist : suggestion.data.items).map((it, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input type="checkbox" disabled className="opacity-50" />
                    {editing ? (
                      <input
                        type="text"
                        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                        value={it.text}
                        onChange={(e) => {
                          const next = [...draftChecklist]
                          next[i] = { ...next[i], text: e.target.value }
                          setDraftChecklist(next)
                        }}
                        data-testid={`ai-checklist-item-${i}`}
                      />
                    ) : (
                      <span>{it.text}</span>
                    )}
                    {it.optional && (
                      <span className="text-xs text-gray-500">(opcional)</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* TAGS */}
          {suggestion.kind === 'tags' && (
            <section aria-label="Tags sugeridos">
              <div className="mb-2">
                <h3 className="text-sm font-semibold text-gray-700">
                  Actuales
                </h3>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(currentTask.tags ?? []).length === 0 && (
                    <span className="text-xs text-gray-500">(sin tags)</span>
                  )}
                  {(currentTask.tags ?? []).map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded bg-gray-100 text-xs"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-blue-700">
                  Sugeridos
                </h3>
                <div
                  className="flex flex-wrap gap-1 mt-1"
                  data-testid="ai-suggested-tags"
                >
                  {suggestion.data.tags.map((t) => (
                    <span
                      key={t.tag}
                      className={`px-2 py-0.5 rounded text-xs ${
                        t.reused
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                      title={t.reused ? 'Reutilizado del proyecto' : 'Nuevo'}
                    >
                      {t.tag}
                    </span>
                  ))}
                </div>
                {editing && (
                  <input
                    type="text"
                    value={draftTags.join(', ')}
                    onChange={(e) =>
                      setDraftTags(
                        e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter((s) => s.length > 0),
                      )
                    }
                    className="mt-2 w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    placeholder="tag1, tag2, tag3"
                    data-testid="ai-suggested-tags-edit"
                  />
                )}
              </div>
            </section>
          )}

          {/* CATEGORIZATION */}
          {suggestion.kind === 'categorization' && (
            <section aria-label="Categorización sugerida">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">
                    Actual
                  </h3>
                  <p className="text-xs text-gray-700">
                    Type: <strong>{currentTask.type ?? '?'}</strong>
                  </p>
                  <p className="text-xs text-gray-700">
                    Priority: <strong>{currentTask.priority ?? '?'}</strong>
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-blue-700">
                    Sugerida
                  </h3>
                  {editing ? (
                    <>
                      <select
                        value={draftType}
                        onChange={(e) => setDraftType(e.target.value)}
                        className="block w-full border border-blue-300 rounded px-2 py-1 text-sm mb-2"
                        data-testid="ai-suggested-type-edit"
                      >
                        <option value="PHASE">PHASE</option>
                        <option value="AGILE_STORY">AGILE_STORY</option>
                        <option value="PMI_TASK">PMI_TASK</option>
                        <option value="ITIL_TICKET">ITIL_TICKET</option>
                      </select>
                      <select
                        value={draftPriority}
                        onChange={(e) => setDraftPriority(e.target.value)}
                        className="block w-full border border-blue-300 rounded px-2 py-1 text-sm"
                        data-testid="ai-suggested-priority-edit"
                      >
                        <option value="LOW">LOW</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="HIGH">HIGH</option>
                        <option value="CRITICAL">CRITICAL</option>
                      </select>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-gray-700">
                        Type:{' '}
                        <strong data-testid="ai-suggested-type">
                          {suggestion.data.suggestedType}
                        </strong>
                      </p>
                      <p className="text-xs text-gray-700">
                        Priority:{' '}
                        <strong data-testid="ai-suggested-priority">
                          {suggestion.data.suggestedPriority}
                        </strong>
                      </p>
                    </>
                  )}
                </div>
              </div>
              <p
                className="mt-3 text-xs text-gray-600 italic"
                data-testid="ai-suggested-reasoning"
              >
                {suggestion.data.reasoning}
              </p>
            </section>
          )}

          {/* DUPLICATES */}
          {suggestion.kind === 'duplicates' && (
            <section aria-label="Posibles duplicados">
              {suggestion.data.candidates.length === 0 ? (
                <p
                  className="text-sm text-gray-500"
                  data-testid="ai-duplicates-empty"
                >
                  No se detectaron duplicados con similarity &gt; 0.7.
                </p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-2">
                    Selecciona la tarea canónica. Esta tarea quedará archivada
                    con una nota de referencia.
                  </p>
                  <ul
                    className="space-y-2"
                    data-testid="ai-duplicates-list"
                  >
                    {suggestion.data.candidates.map((c) => (
                      <li
                        key={c.taskId}
                        className="border border-gray-200 rounded p-2"
                      >
                        <label className="flex items-start gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="duplicate-canonical"
                            checked={duplicatesAction.canonicalId === c.taskId}
                            onChange={() =>
                              setDuplicatesAction({ canonicalId: c.taskId })
                            }
                            data-testid={`ai-duplicate-radio-${c.taskId}`}
                          />
                          <span className="flex-1">
                            <span className="font-mono text-xs text-gray-500">
                              {c.taskId.slice(0, 8)}
                            </span>{' '}
                            <span className="text-xs text-blue-700">
                              ({Math.round(c.similarity * 100)}%)
                            </span>
                            <p className="text-xs text-gray-700 mt-1">
                              {c.reason}
                            </p>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>

        <footer className="border-t border-gray-200 p-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
            data-testid="ai-suggestion-dismiss"
          >
            Descartar
          </button>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-3 py-1 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
              data-testid="ai-suggestion-edit"
            >
              Editar antes de aplicar
            </button>
          )}
          <button
            type="button"
            onClick={handleApply}
            disabled={
              pending ||
              (suggestion.kind === 'duplicates' &&
                !duplicatesAction.canonicalId)
            }
            className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            data-testid="ai-suggestion-apply"
          >
            {pending ? 'Aplicando…' : 'Aceptar y aplicar'}
          </button>
        </footer>
      </div>
    </div>
  )
}
