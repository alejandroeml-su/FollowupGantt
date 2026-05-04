'use client'

/**
 * Ola P5 · Equipo P5-4 · AI Insights — Tarjeta de sugerencia de categorización.
 *
 * Muestra el output de `categorizeTask` en una tarjeta legible:
 *   - Categoría sugerida con confianza %.
 *   - Razones (lista de keywords / mentions).
 *   - Tags y emails sugeridos.
 *   - Botón "Aplicar sugerencia" (callback opcional para que el padre lo
 *     dispare con el server action correspondiente — fuera del alcance
 *     P5-4, lo monta otro equipo / Edwin en TaskForm).
 *   - Botón "Descartar" → llama a `dismissInsight`.
 */

import { useState, useTransition } from 'react'
import { Sparkles, X, Check } from 'lucide-react'
import { dismissInsight } from '@/lib/actions/insights'

interface CategorizationPayload {
  suggestedCategory: string
  suggestedTaskType: string
  reasoning: string[]
  mentionedEmails: string[]
  resolvedAssignees?: Record<string, string>
  suggestedTags: string[]
}

interface Props {
  insightId: string
  score: number
  payload: CategorizationPayload
  onApply?: (payload: CategorizationPayload) => void | Promise<void>
}

export function CategorySuggestionCard({
  insightId,
  score,
  payload,
  onApply,
}: Props): React.JSX.Element | null {
  const [hidden, setHidden] = useState(false)
  const [pending, startTransition] = useTransition()
  const confPct = Math.round(score * 100)

  if (hidden) return null

  function handleDismiss(): void {
    startTransition(async () => {
      try {
        await dismissInsight(insightId)
        setHidden(true)
      } catch (err) {
        console.error('[CategorySuggestionCard] dismiss', err)
      }
    })
  }

  function handleApply(): void {
    if (!onApply) return
    startTransition(async () => {
      try {
        await onApply(payload)
      } catch (err) {
        console.error('[CategorySuggestionCard] apply', err)
      }
    })
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
      <div className="flex items-start gap-2">
        <Sparkles
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600 dark:text-indigo-300"
          aria-hidden
        />
        <div className="flex-1">
          <div className="font-medium text-indigo-900 dark:text-indigo-100">
            Categorización sugerida: {payload.suggestedCategory}{' '}
            <span className="text-xs text-indigo-700 dark:text-indigo-300">
              ({payload.suggestedTaskType} · {confPct}% confianza)
            </span>
          </div>
          {payload.reasoning.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-indigo-800 dark:text-indigo-200">
              {payload.reasoning.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {(payload.suggestedTags.length > 0 || payload.mentionedEmails.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {payload.suggestedTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100"
                >
                  #{tag}
                </span>
              ))}
              {payload.mentionedEmails.map((email) => (
                <span
                  key={email}
                  className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100"
                >
                  @{email}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={handleDismiss}
          className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:text-indigo-300 dark:hover:bg-indigo-900"
        >
          <X className="h-3 w-3" aria-hidden />
          Descartar
        </button>
        {onApply && (
          <button
            type="button"
            disabled={pending}
            onClick={handleApply}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Check className="h-3 w-3" aria-hidden />
            Aplicar sugerencia
          </button>
        )}
      </div>
    </div>
  )
}
