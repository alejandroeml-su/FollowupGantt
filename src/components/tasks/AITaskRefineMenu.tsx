'use client'

/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — Dropdown de acciones.
 *
 * Botón "✨ IA" que despliega un menú con 5 acciones:
 *   - Mejorar descripción
 *   - Sugerir checklist
 *   - Sugerir tags
 *   - Buscar duplicados
 *   - Refinar categoría
 *
 * Al click → llama el server action correspondiente y abre
 * `AISuggestionDialog` con la sugerencia. Usamos `useTransition` para
 * que el dropdown muestre estado loading sin bloquear el resto del UI.
 *
 * Implementación del dropdown sin librería de UI extra (solo botón
 * + lista absolute + click-outside). El Avante design system no tiene
 * primitivo equivalente todavía.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  AISuggestionDialog,
  type SuggestionPayload,
  type RefinementKind,
} from './AISuggestionDialog'
import {
  improveDescriptionAction,
  suggestChecklistAction,
  suggestTagsAction,
  detectDuplicatesAction,
  refineCategorizationAction,
} from '@/lib/actions/task-refinement'
import type { RefinementSource } from '@/lib/ai/refinement/schemas'

interface MenuItem {
  kind: RefinementKind
  label: string
  emoji: string
}

const MENU_ITEMS: MenuItem[] = [
  { kind: 'description', label: 'Mejorar descripción', emoji: '📝' },
  { kind: 'checklist', label: 'Sugerir checklist', emoji: '✅' },
  { kind: 'tags', label: 'Sugerir tags', emoji: '🏷️' },
  { kind: 'duplicates', label: 'Buscar duplicados', emoji: '🔍' },
  { kind: 'categorization', label: 'Refinar categoría', emoji: '📂' },
]

export interface AITaskRefineMenuProps {
  taskId: string
  currentTask: {
    title: string
    description?: string | null
    type?: string | null
    priority?: string | null
    tags?: string[]
  }
  /** Callback opcional para refrescar el padre tras aplicar (router.refresh). */
  onApplied?: () => void
}

export function AITaskRefineMenu({
  taskId,
  currentTask,
  onApplied,
}: AITaskRefineMenuProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingKind, setPendingKind] = useState<RefinementKind | null>(null)
  const [, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<SuggestionPayload | null>(null)
  const [source, setSource] = useState<RefinementSource>('llm')
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Click-outside para cerrar el menú.
  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(ev: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(ev.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  function runAction(kind: RefinementKind) {
    setMenuOpen(false)
    setError(null)
    setPendingKind(kind)
    startTransition(async () => {
      try {
        let envelope:
          | Awaited<ReturnType<typeof improveDescriptionAction>>
          | Awaited<ReturnType<typeof suggestChecklistAction>>
          | Awaited<ReturnType<typeof suggestTagsAction>>
          | Awaited<ReturnType<typeof detectDuplicatesAction>>
          | Awaited<ReturnType<typeof refineCategorizationAction>>

        if (kind === 'description') {
          envelope = await improveDescriptionAction(taskId)
          setSuggestion({ kind: 'description', data: envelope.data })
        } else if (kind === 'checklist') {
          envelope = await suggestChecklistAction(taskId)
          setSuggestion({ kind: 'checklist', data: envelope.data })
        } else if (kind === 'tags') {
          envelope = await suggestTagsAction(taskId)
          setSuggestion({ kind: 'tags', data: envelope.data })
        } else if (kind === 'duplicates') {
          envelope = await detectDuplicatesAction(taskId)
          setSuggestion({ kind: 'duplicates', data: envelope.data })
        } else {
          envelope = await refineCategorizationAction(taskId)
          setSuggestion({ kind: 'categorization', data: envelope.data })
        }

        setSource(envelope.source)
        setFallbackReason(envelope.fallbackReason ?? null)
        setDialogOpen(true)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
      } finally {
        setPendingKind(null)
      }
    })
  }

  function handleApplied() {
    setDialogOpen(false)
    setSuggestion(null)
    onApplied?.()
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      data-testid="ai-task-refine-menu"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        disabled={pendingKind !== null}
        className="px-3 py-1 text-sm rounded border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 disabled:opacity-50 inline-flex items-center gap-1"
        data-testid="ai-task-refine-trigger"
      >
        <span aria-hidden>✨</span>
        <span>{pendingKind ? 'Generando…' : 'IA'}</span>
        <span aria-hidden className="text-xs">▾</span>
      </button>

      {menuOpen && (
        <ul
          role="menu"
          className="absolute right-0 mt-1 z-10 min-w-[220px] bg-white border border-gray-200 rounded shadow-lg py-1"
          data-testid="ai-task-refine-list"
        >
          {MENU_ITEMS.map((it) => (
            <li key={it.kind} role="none">
              <button
                role="menuitem"
                type="button"
                onClick={() => runAction(it.kind)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                data-testid={`ai-task-refine-item-${it.kind}`}
              >
                <span aria-hidden>{it.emoji}</span>
                <span>{it.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div
          className="absolute right-0 mt-1 z-10 max-w-xs p-2 border border-red-300 bg-red-50 text-red-800 rounded text-xs"
          role="alert"
          data-testid="ai-task-refine-error"
        >
          {error}
        </div>
      )}

      <AISuggestionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        taskId={taskId}
        currentTask={currentTask}
        suggestion={suggestion}
        source={source}
        fallbackReason={fallbackReason}
        onApplied={handleApplied}
        onError={(msg) => setError(msg)}
      />
    </div>
  )
}
