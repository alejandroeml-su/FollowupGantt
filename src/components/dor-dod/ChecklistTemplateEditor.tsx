'use client'

/**
 * Wave P9 R2 (HU-9.8) — Editor reutilizable de plantilla de checklist
 * (DoR o DoD). Modal único parametrizado por `mode`.
 *
 * UX:
 *   - Lista actual con drag-handle, edición inline y botón eliminar.
 *   - Input "Añadir criterio… (Enter)" + botón ➕.
 *   - "Insertar plantilla sugerida" cuando la lista está vacía
 *     (carga `DEFAULT_DOR_TEMPLATE` o `DEFAULT_DOD_TEMPLATE`).
 *   - Save → llama server action correspondiente.
 *
 * No hay drag-drop reorder en MVP — el orden se mantiene por inserción
 * y se puede editar texto, agregar/eliminar. Si crece, agregar dnd-kit.
 */

import { useEffect, useState, useTransition } from 'react'
import { Plus, Trash2, Edit2, X as CloseIcon, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import {
  setProjectDoR,
  setProjectDoD,
} from '@/lib/actions/dor-dod'
import {
  DEFAULT_DOR_TEMPLATE,
  DEFAULT_DOD_TEMPLATE,
} from '@/lib/dor-dod/types'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  open: boolean
  onClose: () => void
  projectId: string
  mode: 'DOR' | 'DOD'
  initial: string[]
  /**
   * Wave P9 follow-up — nombre del proyecto/producto para clarificar
   * el alcance ("DoR/DoD se definen a nivel de Producto").
   */
  projectName?: string
}

const META = {
  DOR: {
    title: 'Definition of Ready',
    subtitle:
      'Criterios mínimos para que una Story pueda moverse a IN_PROGRESS.',
    suggestedLabel: 'Insertar plantilla DoR sugerida',
    suggested: DEFAULT_DOR_TEMPLATE,
    tone: 'indigo',
  },
  DOD: {
    title: 'Definition of Done',
    subtitle:
      'Criterios mínimos para considerar una Story como DONE. Validación SOFT — el usuario sigue en control.',
    suggestedLabel: 'Insertar plantilla DoD sugerida',
    suggested: DEFAULT_DOD_TEMPLATE,
    tone: 'emerald',
  },
} as const

export function ChecklistTemplateEditor({
  open,
  onClose,
  projectId,
  mode,
  initial,
  projectName,
}: Props) {
  const meta = META[mode]
  const [items, setItems] = useState<string[]>(initial)
  const [draftText, setDraftText] = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    // Sync state al snapshot del server cuando el modal abre o cuando
    // cambia `initial` (re-fetch tras save). El setState dentro de
    // efecto es intencional: el modal arranca cerrado y necesitamos
    // hidratar la lista al abrirse.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(initial)
    setDraftText('')
    setEditingIdx(null)
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = orig
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleAdd = () => {
    const t = draftText.trim()
    if (!t) return
    setItems((prev) => {
      // Dedupe case-insensitive.
      if (prev.some((x) => x.toLowerCase() === t.toLowerCase())) return prev
      return [...prev, t]
    })
    setDraftText('')
  }

  const handleRemove = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const startEditing = (idx: number) => {
    setEditingIdx(idx)
    setEditingText(items[idx])
  }
  const commitEdit = () => {
    if (editingIdx === null) return
    const t = editingText.trim()
    if (!t) {
      setEditingIdx(null)
      return
    }
    setItems((prev) =>
      prev.map((item, i) => (i === editingIdx ? t : item)),
    )
    setEditingIdx(null)
  }

  const insertSuggested = () => {
    setItems(Array.from(meta.suggested))
  }

  const handleSave = () => {
    startTransition(async () => {
      try {
        if (mode === 'DOR') {
          await setProjectDoR({ projectId, items })
          toast.success('Definition of Ready actualizada')
        } else {
          await setProjectDoD({ projectId, items })
          toast.success('Definition of Done actualizada')
        }
        onClose()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {meta.title}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {meta.subtitle}
            </p>
            {projectName && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                📦 Definido a nivel del Producto:{' '}
                <span className="font-semibold">{projectName}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          {/* Lista de criterios actuales */}
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-subtle/50 p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                Sin criterios definidos
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Agrega manualmente o usa la plantilla sugerida.
              </p>
              <button
                type="button"
                onClick={insertSuggested}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {meta.suggestedLabel}
              </button>
            </div>
          ) : (
            <ul className="space-y-1">
              {items.map((item, idx) => (
                <li
                  key={`${idx}-${item}`}
                  className="group flex items-start gap-2 rounded border border-transparent px-2 py-1.5 hover:border-border hover:bg-card"
                >
                  <span className="mt-0.5 w-5 shrink-0 text-right text-[10px] font-mono text-muted-foreground tabular-nums">
                    {idx + 1}.
                  </span>
                  {editingIdx === idx ? (
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') setEditingIdx(null)
                      }}
                      autoFocus
                      className="flex-1 rounded border border-primary bg-input px-1.5 py-0.5 text-sm text-input-foreground focus:outline-none"
                    />
                  ) : (
                    <span className="flex-1 text-sm text-foreground">{item}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => startEditing(idx)}
                    aria-label="Editar"
                    className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    aria-label="Eliminar"
                    className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Input add */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              placeholder="Añadir criterio… (Enter)"
              disabled={isPending}
              className="flex-1 rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground placeholder:text-placeholder focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!draftText.trim() || isPending}
              aria-label="Agregar"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar
            </button>
          </div>

          {items.length > 0 && (
            <div className="flex items-center justify-between rounded bg-subtle/50 px-2 py-1.5 text-[11px]">
              <span className="text-muted-foreground">
                {items.length} criterio{items.length === 1 ? '' : 's'} definido
                {items.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => setItems([])}
                className="text-muted-foreground hover:text-destructive"
              >
                Limpiar todos
              </button>
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className={clsx(
              'rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary/80 disabled:opacity-60',
            )}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </div>
    </div>
  )
}
