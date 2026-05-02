'use client'

/**
 * Ola P2 · Equipo P2-1 — Diálogo "Gestionar vistas".
 *
 * Lista las vistas del usuario para una superficie, permitiendo renombrar,
 * marcar como default, alternar visibilidad compartida y eliminar.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { useState, useTransition } from 'react'
import { Star, Trash2, Users, X as CloseIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from '@/components/interactions/Toaster'
import {
  deleteView,
  setDefaultView,
  updateView,
  type ViewSurfaceLiteral,
} from '@/lib/actions/saved-views'

type ViewItem = {
  id: string
  name: string
  isShared: boolean
  isDefault: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  surface: ViewSurfaceLiteral
  views: ViewItem[]
  onChanged?: () => void
}

function parseActionError(err: unknown): { code: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
  return m ? { code: m[1], detail: m[2] } : { code: 'UNKNOWN', detail: msg }
}

export function ManageViewsDialog({
  open,
  onOpenChange,
  surface,
  views,
  onChanged,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  function commitRename(id: string) {
    const name = editingName.trim()
    if (!name) {
      setEditingId(null)
      return
    }
    startTransition(async () => {
      try {
        await updateView(id, { name })
        toast.success('Vista renombrada')
        setEditingId(null)
        onChanged?.()
      } catch (err) {
        const { code, detail } = parseActionError(err)
        toast.error(
          code === 'VIEW_NAME_DUPLICATE'
            ? `Nombre duplicado · ${detail}`
            : `[${code}] ${detail}`,
        )
      }
    })
  }

  function onToggleShared(v: ViewItem) {
    startTransition(async () => {
      try {
        await updateView(v.id, { isShared: !v.isShared })
        onChanged?.()
      } catch (err) {
        const { code, detail } = parseActionError(err)
        toast.error(`[${code}] ${detail}`)
      }
    })
  }

  function onSetDefault(v: ViewItem) {
    startTransition(async () => {
      try {
        await setDefaultView(v.id, surface)
        toast.success(`"${v.name}" es ahora la vista por defecto`)
        onChanged?.()
      } catch (err) {
        const { code, detail } = parseActionError(err)
        toast.error(`[${code}] ${detail}`)
      }
    })
  }

  function onDelete(v: ViewItem) {
    if (!confirm(`¿Eliminar la vista "${v.name}"?`)) return
    startTransition(async () => {
      try {
        await deleteView(v.id)
        toast.success('Vista eliminada')
        onChanged?.()
      } catch (err) {
        const { code, detail } = parseActionError(err)
        toast.error(`[${code}] ${detail}`)
      }
    })
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!isPending) onOpenChange(o)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="manage-views-dialog"
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border bg-card p-5 shadow-2xl',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-2">
            <Dialog.Title className="text-base font-semibold text-foreground">
              Gestionar vistas guardadas
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Cerrar"
                disabled={isPending}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {views.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No tienes vistas guardadas todavía. Usa &quot;Guardar como…&quot;
              para crear la primera.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {views.map((v) => (
                <li
                  key={v.id}
                  data-testid={`manage-view-row-${v.id}`}
                  className="flex items-center gap-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => onSetDefault(v)}
                    disabled={isPending || v.isDefault}
                    aria-label={
                      v.isDefault
                        ? 'Vista por defecto'
                        : 'Marcar como vista por defecto'
                    }
                    className={clsx(
                      'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-100',
                      v.isDefault && 'text-amber-400',
                    )}
                  >
                    <Star
                      className={clsx('h-4 w-4', v.isDefault && 'fill-current')}
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    {editingId === v.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) =>
                          setEditingName(e.target.value.slice(0, 120))
                        }
                        onBlur={() => commitRename(v.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(v.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        autoFocus
                        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onDoubleClick={() => {
                          setEditingId(v.id)
                          setEditingName(v.name)
                        }}
                        className="truncate text-left text-sm font-medium text-foreground hover:text-primary"
                        title="Doble clic para renombrar"
                      >
                        {v.name}
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onToggleShared(v)}
                    disabled={isPending}
                    aria-pressed={v.isShared}
                    aria-label={
                      v.isShared
                        ? 'Compartida con todos. Click para hacer privada.'
                        : 'Privada. Click para compartir con todos.'
                    }
                    className={clsx(
                      'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground',
                      v.isShared && 'text-emerald-400',
                    )}
                  >
                    <Users className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onDelete(v)}
                    disabled={isPending}
                    aria-label={`Eliminar "${v.name}"`}
                    className="rounded p-1 text-muted-foreground hover:bg-red-500/20 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
