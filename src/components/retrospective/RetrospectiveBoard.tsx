'use client'

/**
 * Wave P9 R2 (HU-9.9) — Tablero de retrospectiva.
 *
 * Layout: N columnas según `format` (3 o 4). Cada columna:
 *   - Header con emoji + label.
 *   - Items con texto, votes (heart toggle), botón eliminar (autor).
 *   - Botón "Convertir a Task" si no hay taskId; chip con mnemonic
 *     si ya tiene una.
 *   - Input "Añadir item… (Enter)" al final.
 *
 * Estado: si la retro está completed, todo en readonly + banner.
 */

import { useState, useTransition } from 'react'
import { Heart, Plus, Trash2, Edit2, ListChecks, CheckCircle2, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import {
  addRetroItem,
  removeRetroItem,
  toggleRetroItemVote,
  updateRetroItemText,
  convertRetroItemToTask,
  completeRetrospective,
} from '@/lib/actions/retrospective'
import {
  FORMAT_DEFINITIONS,
  type RetroItem,
  type RetrospectiveData,
  type RetrospectiveFormat,
} from '@/lib/retrospective/types'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  retroId: string
  format: RetrospectiveFormat
  initialData: RetrospectiveData
  completed: boolean
  currentUserId: string | null
}

const TONE_BG: Record<string, string> = {
  emerald: 'border-emerald-500/40 bg-emerald-500/5',
  amber: 'border-amber-500/40 bg-amber-500/5',
  indigo: 'border-indigo-500/40 bg-indigo-500/5',
  violet: 'border-violet-500/40 bg-violet-500/5',
  rose: 'border-rose-500/40 bg-rose-500/5',
}

export default function RetrospectiveBoard({
  retroId,
  format,
  initialData,
  completed,
  currentUserId,
}: Props) {
  const [data, setData] = useState<RetrospectiveData>(initialData)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const columns = FORMAT_DEFINITIONS[format]

  // ── Add item ────────────────────────────────────────────────────
  const handleAdd = (categoryId: string) => {
    const text = (drafts[categoryId] ?? '').trim()
    if (!text) return
    startTransition(async () => {
      try {
        const item = await addRetroItem({
          retrospectiveId: retroId,
          categoryId,
          text,
          authorId: currentUserId,
        })
        setData((d) => ({
          ...d,
          categories: {
            ...d.categories,
            [categoryId]: {
              ...d.categories[categoryId],
              items: [...d.categories[categoryId].items, item],
            },
          },
        }))
        setDrafts((p) => ({ ...p, [categoryId]: '' }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al agregar')
      }
    })
  }

  // ── Vote ────────────────────────────────────────────────────────
  const handleVote = (itemId: string) => {
    if (!currentUserId) {
      toast.error('Necesitas estar autenticado para votar')
      return
    }
    startTransition(async () => {
      try {
        const updated = await toggleRetroItemVote({
          retrospectiveId: retroId,
          itemId,
          userId: currentUserId,
        })
        setData((d) => {
          const next = { ...d, categories: { ...d.categories } }
          for (const [cid, cat] of Object.entries(next.categories)) {
            const idx = cat.items.findIndex((i) => i.id === itemId)
            if (idx >= 0) {
              const newItems = [...cat.items]
              newItems[idx] = updated
              next.categories[cid] = { ...cat, items: newItems }
              break
            }
          }
          return next
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al votar')
      }
    })
  }

  // ── Remove ──────────────────────────────────────────────────────
  const handleRemove = (itemId: string) => {
    if (!confirm('¿Eliminar este item?')) return
    startTransition(async () => {
      try {
        await removeRetroItem({ retrospectiveId: retroId, itemId })
        setData((d) => {
          const next = { ...d, categories: { ...d.categories } }
          for (const [cid, cat] of Object.entries(next.categories)) {
            next.categories[cid] = {
              ...cat,
              items: cat.items.filter((i) => i.id !== itemId),
            }
          }
          return next
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al eliminar')
      }
    })
  }

  // ── Edit text ───────────────────────────────────────────────────
  const startEditing = (item: RetroItem) => {
    setEditingId(item.id)
    setEditingText(item.text)
  }
  const commitEdit = () => {
    if (!editingId) return
    const text = editingText.trim()
    if (!text) {
      setEditingId(null)
      return
    }
    const id = editingId
    startTransition(async () => {
      try {
        const updated = await updateRetroItemText({
          retrospectiveId: retroId,
          itemId: id,
          text,
        })
        setData((d) => {
          const next = { ...d, categories: { ...d.categories } }
          for (const [cid, cat] of Object.entries(next.categories)) {
            const idx = cat.items.findIndex((i) => i.id === id)
            if (idx >= 0) {
              const newItems = [...cat.items]
              newItems[idx] = updated
              next.categories[cid] = { ...cat, items: newItems }
              break
            }
          }
          return next
        })
        setEditingId(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  // ── Convert to Task ─────────────────────────────────────────────
  const handleConvert = (item: RetroItem) => {
    if (item.taskId) {
      toast.success('Este item ya tiene una tarea asociada')
      return
    }
    if (!confirm(`¿Convertir "${item.text.slice(0, 60)}…" en una Task del proyecto?`)) {
      return
    }
    startTransition(async () => {
      try {
        const r = await convertRetroItemToTask({
          retrospectiveId: retroId,
          itemId: item.id,
        })
        toast.success(
          r.alreadyExisted
            ? 'Task ya existía'
            : `Task creada: ${r.task.mnemonic ?? r.task.id}`,
        )
        // Optimistic update local del taskId.
        setData((d) => {
          const next = { ...d, categories: { ...d.categories } }
          for (const [cid, cat] of Object.entries(next.categories)) {
            const idx = cat.items.findIndex((i) => i.id === item.id)
            if (idx >= 0) {
              const newItems = [...cat.items]
              newItems[idx] = { ...newItems[idx], taskId: r.task.id }
              next.categories[cid] = { ...cat, items: newItems }
              break
            }
          }
          return next
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al convertir')
      }
    })
  }

  // ── Complete ───────────────────────────────────────────────────
  const handleComplete = () => {
    if (!confirm('¿Cerrar la retrospectiva? Tras esto no se podrán editar más items.')) {
      return
    }
    startTransition(async () => {
      try {
        await completeRetrospective({ id: retroId })
        toast.success('Retrospectiva cerrada')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cerrar')
      }
    })
  }

  // Métricas para el header.
  const totalItems = Object.values(data.categories).reduce(
    (acc, cat) => acc + cat.items.length,
    0,
  )
  const totalVotes = Object.values(data.categories).reduce(
    (acc, cat) => acc + cat.items.reduce((a, i) => a + i.votes.length, 0),
    0,
  )
  const totalActionItems = Object.values(data.categories).reduce(
    (acc, cat) => acc + cat.items.filter((i) => i.taskId).length,
    0,
  )

  return (
    <>
      {/* Banner si está cerrada */}
      {completed && (
        <div className="m-6 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          <span className="flex-1">
            Esta retrospectiva está cerrada. Los items son de sólo lectura
            (audit log).
          </span>
        </div>
      )}

      {/* Toolbar superior con métricas + cerrar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-subtle px-6 py-2.5">
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>
            <strong className="text-foreground">{totalItems}</strong> items
          </span>
          <span>
            <strong className="text-foreground">{totalVotes}</strong> votos
          </span>
          <span>
            <strong className="text-foreground">{totalActionItems}</strong> action items
          </span>
        </div>
        {!completed && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-60 border border-emerald-500/40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Cerrar retrospectiva
          </button>
        )}
      </div>

      {/* Grid de columnas */}
      <div
        className={clsx(
          'flex-1 overflow-auto p-6 grid gap-4',
          columns.length === 4 ? 'grid-cols-4' : 'grid-cols-3',
        )}
      >
        {columns.map((col) => {
          const cat = data.categories[col.id]
          const items = cat?.items ?? []
          // Sort: más votos primero.
          const sorted = [...items].sort(
            (a, b) => b.votes.length - a.votes.length,
          )

          return (
            <div
              key={col.id}
              className={clsx(
                'flex h-full flex-col rounded-xl border bg-card',
                TONE_BG[col.tone] ?? 'border-border bg-card',
              )}
            >
              <header className="border-b border-border/50 px-3 py-2.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span aria-hidden>{col.emoji}</span>
                  {col.label}
                </h3>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {items.length} {items.length === 1 ? 'item' : 'items'}
                </p>
              </header>

              <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
                {sorted.length === 0 ? (
                  <p className="px-2 py-3 text-center text-[11px] italic text-muted-foreground">
                    Sin items todavía.
                  </p>
                ) : (
                  sorted.map((item) => (
                    <RetroItemCard
                      key={item.id}
                      item={item}
                      currentUserId={currentUserId}
                      readonly={completed}
                      isEditing={editingId === item.id}
                      editingText={editingText}
                      setEditingText={setEditingText}
                      onCommitEdit={commitEdit}
                      onCancelEdit={() => setEditingId(null)}
                      onStartEdit={() => startEditing(item)}
                      onVote={() => handleVote(item.id)}
                      onRemove={() => handleRemove(item.id)}
                      onConvert={() => handleConvert(item)}
                    />
                  ))
                )}
              </div>

              {!completed && (
                <div className="border-t border-border/50 p-2">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={drafts[col.id] ?? ''}
                      onChange={(e) =>
                        setDrafts((p) => ({ ...p, [col.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAdd(col.id)
                        }
                      }}
                      placeholder="Añadir item… (Enter)"
                      disabled={isPending}
                      className="flex-1 rounded border border-border bg-input px-2 py-1 text-xs text-input-foreground placeholder:text-placeholder focus:border-primary focus:outline-none disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => handleAdd(col.id)}
                      disabled={!(drafts[col.id]?.trim()) || isPending}
                      aria-label="Agregar"
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function RetroItemCard({
  item,
  currentUserId,
  readonly,
  isEditing,
  editingText,
  setEditingText,
  onCommitEdit,
  onCancelEdit,
  onStartEdit,
  onVote,
  onRemove,
  onConvert,
}: {
  item: RetroItem
  currentUserId: string | null
  readonly: boolean
  isEditing: boolean
  editingText: string
  setEditingText: (v: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onStartEdit: () => void
  onVote: () => void
  onRemove: () => void
  onConvert: () => void
}) {
  const userVoted = currentUserId ? item.votes.includes(currentUserId) : false
  const isOwner = currentUserId && item.authorId === currentUserId

  return (
    <article
      className={clsx(
        'group rounded-md border border-border/40 bg-background p-2 shadow-sm transition-colors hover:border-indigo-500/40',
        item.taskId && 'border-l-2 border-l-indigo-500',
      )}
    >
      {isEditing ? (
        <input
          type="text"
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit()
            if (e.key === 'Escape') onCancelEdit()
          }}
          autoFocus
          className="w-full rounded border border-primary bg-input px-1.5 py-0.5 text-xs text-input-foreground focus:outline-none"
        />
      ) : (
        <p className="text-xs text-foreground">{item.text}</p>
      )}

      <footer className="mt-1.5 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onVote}
            disabled={readonly || !currentUserId}
            aria-label={userVoted ? 'Quitar voto' : 'Votar'}
            className={clsx(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-50',
              userVoted
                ? 'bg-rose-500/15 text-rose-300'
                : 'bg-secondary text-muted-foreground hover:bg-secondary/80',
            )}
          >
            <Heart
              className={clsx('h-3 w-3', userVoted && 'fill-current')}
              aria-hidden
            />
            {item.votes.length}
          </button>

          {item.taskId && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300 border border-indigo-500/40"
              title="Action item convertido a Task"
            >
              <ListChecks className="h-2.5 w-2.5" />
              Task
            </span>
          )}
        </div>

        {!readonly && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {!item.taskId && (
              <button
                type="button"
                onClick={onConvert}
                aria-label="Convertir a Task"
                title="Convertir a Task"
                className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-indigo-300"
              >
                <Sparkles className="h-3 w-3" />
              </button>
            )}
            {isOwner && (
              <>
                <button
                  type="button"
                  onClick={onStartEdit}
                  aria-label="Editar"
                  className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  aria-label="Eliminar"
                  className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
        )}
      </footer>
    </article>
  )
}
