'use client'

/**
 * Wave P9 · Agile Maturity (HU-9.3) — Sección "Historia de Usuario"
 * embebida en el TaskForm cuando `type === 'AGILE_STORY'`.
 *
 * UX:
 *   - 3 textareas: "Como un / Quiero / Para".
 *   - Lista de criterios de aceptación con checkbox + edición inline +
 *     botón eliminar.
 *   - Input al final: "Añadir criterio…" + Enter (o botón ➕).
 *   - Barra de progreso si hay CAs marcados.
 *
 * Persistencia: cada interacción dispara su server action correspondiente
 * (`setUserStory`, `addAcceptanceCriterion`, `toggleAcceptanceCriterion`,
 * `removeAcceptanceCriterion`, `updateAcceptanceCriterion`).
 *
 * Modos:
 *   - `mode='edit'`: persiste vía actions on-blur / on-toggle.
 *   - `mode='create'`: trabaja en memoria, expone `onChange(story)` para
 *     que el padre lo persista junto al rest del form al guardar.
 */

import { useEffect, useState, useTransition } from 'react'
import { Plus, Trash2, Check, Edit2 } from 'lucide-react'
import { clsx } from 'clsx'
import {
  emptyUserStory,
  generateCriterionId,
  userStoryCompletionRate,
  type AcceptanceCriterion,
  type UserStory,
} from '@/lib/user-story/types'
import {
  setUserStory,
  addAcceptanceCriterion,
  toggleAcceptanceCriterion,
  removeAcceptanceCriterion,
  updateAcceptanceCriterion,
} from '@/lib/actions/user-story'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  mode: 'create' | 'edit'
  /** Solo en mode='edit'. */
  taskId?: string
  /** Valor inicial (puede ser null para mostrar empty state). */
  initial: UserStory | null
  /** Callback en mode='create' para que el padre persista al guardar. */
  onChange?: (story: UserStory) => void
}

export function UserStorySection({ mode, taskId, initial, onChange }: Props) {
  const [story, setStory] = useState<UserStory>(() => initial ?? emptyUserStory())
  const [newCriterionText, setNewCriterionText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [isPending, startTransition] = useTransition()

  // Sync local cuando el padre cambia el initial (re-fetch).
  useEffect(() => {
    if (mode === 'edit') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStory(initial ?? emptyUserStory())
    }
  }, [initial, mode])

  // En mode='create' notificamos al padre cada cambio.
  useEffect(() => {
    if (mode === 'create') {
      onChange?.(story)
    }
  }, [story, mode, onChange])

  // ── 3 campos principales ─────────────────────────────────────────
  const persistFields = (next: UserStory) => {
    setStory(next)
    if (mode === 'edit' && taskId) {
      startTransition(async () => {
        try {
          await setUserStory({
            taskId,
            asA: next.asA,
            iWant: next.iWant,
            soThat: next.soThat,
            criteria: next.criteria,
          })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Error al guardar')
        }
      })
    }
  }

  // ── Add CA ───────────────────────────────────────────────────────
  const handleAdd = () => {
    const text = newCriterionText.trim()
    if (!text) return

    if (mode === 'edit' && taskId) {
      startTransition(async () => {
        try {
          const c = await addAcceptanceCriterion({ taskId, text })
          setStory((s) => ({ ...s, criteria: [...s.criteria, c] }))
          setNewCriterionText('')
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Error al agregar')
        }
      })
    } else {
      // create mode — local only.
      const c: AcceptanceCriterion = {
        id: generateCriterionId(),
        text,
        done: false,
        doneAt: null,
      }
      setStory((s) => ({ ...s, criteria: [...s.criteria, c] }))
      setNewCriterionText('')
    }
  }

  // ── Toggle CA ────────────────────────────────────────────────────
  const handleToggle = (id: string) => {
    if (mode === 'edit' && taskId) {
      startTransition(async () => {
        try {
          const updated = await toggleAcceptanceCriterion({ taskId, criterionId: id })
          setStory((s) => ({
            ...s,
            criteria: s.criteria.map((c) => (c.id === id ? updated : c)),
          }))
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Error')
        }
      })
    } else {
      setStory((s) => ({
        ...s,
        criteria: s.criteria.map((c) =>
          c.id === id
            ? { ...c, done: !c.done, doneAt: !c.done ? new Date().toISOString() : null }
            : c,
        ),
      }))
    }
  }

  // ── Remove CA ────────────────────────────────────────────────────
  const handleRemove = (id: string) => {
    if (!confirm('¿Eliminar este criterio?')) return
    if (mode === 'edit' && taskId) {
      startTransition(async () => {
        try {
          await removeAcceptanceCriterion({ taskId, criterionId: id })
          setStory((s) => ({ ...s, criteria: s.criteria.filter((c) => c.id !== id) }))
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Error')
        }
      })
    } else {
      setStory((s) => ({ ...s, criteria: s.criteria.filter((c) => c.id !== id) }))
    }
  }

  // ── Edit inline ──────────────────────────────────────────────────
  const startEditing = (c: AcceptanceCriterion) => {
    setEditingId(c.id)
    setEditingText(c.text)
  }
  const commitEdit = () => {
    if (!editingId) return
    const text = editingText.trim()
    if (!text) {
      setEditingId(null)
      return
    }
    if (mode === 'edit' && taskId) {
      startTransition(async () => {
        try {
          const updated = await updateAcceptanceCriterion({
            taskId,
            criterionId: editingId,
            text,
          })
          setStory((s) => ({
            ...s,
            criteria: s.criteria.map((c) => (c.id === editingId ? updated : c)),
          }))
          setEditingId(null)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Error')
        }
      })
    } else {
      setStory((s) => ({
        ...s,
        criteria: s.criteria.map((c) =>
          c.id === editingId ? { ...c, text } : c,
        ),
      }))
      setEditingId(null)
    }
  }

  const completionRate = userStoryCompletionRate(story)
  const totalCriteria = story.criteria.length
  const doneCriteria = story.criteria.filter((c) => c.done).length

  return (
    <section className="space-y-4 rounded-lg border border-border bg-subtle/30 p-4">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Historia de Usuario
        </h3>
        {totalCriteria > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {doneCriteria}/{totalCriteria} criterios
            </span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
              <div
                className={clsx(
                  'h-full transition-all',
                  completionRate === 100 ? 'bg-emerald-500' : 'bg-indigo-500',
                )}
                style={{ width: `${completionRate ?? 0}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {/* 3 textareas */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <UserStoryField
          id="us-asA"
          label="Como un"
          placeholder="Project Owner"
          value={story.asA}
          onCommit={(v) => persistFields({ ...story, asA: v })}
          disabled={isPending}
        />
        <UserStoryField
          id="us-iWant"
          label="Quiero"
          placeholder="crear Epics dentro de un proyecto"
          value={story.iWant}
          onCommit={(v) => persistFields({ ...story, iWant: v })}
          disabled={isPending}
        />
        <UserStoryField
          id="us-soThat"
          label="Para"
          placeholder="agrupar Stories bajo iniciativas"
          value={story.soThat}
          onCommit={(v) => persistFields({ ...story, soThat: v })}
          disabled={isPending}
        />
      </div>

      {/* Lista de CAs */}
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Criterios de Aceptación
        </div>
        {story.criteria.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground">
            Sin criterios. Agrega al menos uno antes de mover la tarea a Done.
          </p>
        ) : (
          <ul className="space-y-1">
            {story.criteria.map((c) => (
              <li
                key={c.id}
                className={clsx(
                  'group flex items-start gap-2 rounded border border-transparent px-2 py-1.5 hover:border-border hover:bg-card',
                  c.done && 'opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  checked={c.done}
                  onChange={() => handleToggle(c.id)}
                  disabled={isPending}
                  aria-label={`Marcar ${c.text}`}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-indigo-500"
                />
                {editingId === c.id ? (
                  <input
                    type="text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    autoFocus
                    className="flex-1 rounded border border-primary bg-input px-1.5 py-0.5 text-sm text-input-foreground focus:outline-none"
                  />
                ) : (
                  <span
                    className={clsx(
                      'flex-1 text-sm text-foreground',
                      c.done && 'line-through',
                    )}
                  >
                    {c.text}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => startEditing(c)}
                  aria-label="Editar"
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(c.id)}
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
            value={newCriterionText}
            onChange={(e) => setNewCriterionText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="Añadir criterio… (Enter para guardar)"
            disabled={isPending}
            className="flex-1 rounded-md border border-border bg-input px-2 py-1 text-sm text-input-foreground placeholder:text-placeholder focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newCriterionText.trim() || isPending}
            aria-label="Agregar criterio"
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </button>
        </div>
      </div>
    </section>
  )
}

/**
 * Campo de texto auto-resize que persiste on-blur. Mantiene su propio
 * state local para no triggerar `setUserStory` en cada keystroke.
 */
function UserStoryField({
  id,
  label,
  placeholder,
  value,
  onCommit,
  disabled,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  onCommit: (value: string) => void
  disabled: boolean
}) {
  const [local, setLocal] = useState(value)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(value)
  }, [value])

  return (
    <label htmlFor={id} className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <textarea
        id={id}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local.trim() !== value.trim()) onCommit(local)
        }}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
        className="w-full resize-none rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground placeholder:text-placeholder focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
      />
    </label>
  )
}

/** Re-export marker para que tests-de-snapshot detecten el done helper. */
export { Check }
