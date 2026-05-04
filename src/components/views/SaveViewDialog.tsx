'use client'

/**
 * Ola P2 · Equipo P2-1 — Diálogo "Guardar como…" para Saved Views.
 *
 * Recibe la configuración actual (filters, grouping, sorting, columnPrefs) y
 * permite al usuario nombrarla, marcarla como compartida y persistirla
 * mediante el server action `createView`.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState, useTransition } from 'react'
import { Save, X as CloseIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from '@/components/interactions/Toaster'
import { createView } from '@/lib/actions/saved-views'
import type {
  ViewSurfaceLiteral,
} from '@/lib/actions/saved-views'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  surface: ViewSurfaceLiteral
  /** Estado capturado al abrir el diálogo. Sustituye la "vista activa". */
  filters: Record<string, unknown>
  grouping?: string | null
  sorting?: { field: string; direction: 'asc' | 'desc' } | null
  columnPrefs?: Record<string, unknown> | null
  onSaved?: (view: { id: string; name: string }) => void
}

function parseActionError(err: unknown): { code: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
  return m ? { code: m[1], detail: m[2] } : { code: 'UNKNOWN', detail: msg }
}

export function SaveViewDialog({
  open,
  onOpenChange,
  surface,
  filters,
  grouping = null,
  sorting = null,
  columnPrefs = null,
  onSaved,
}: Props) {
  const [name, setName] = useState('')
  const [isShared, setIsShared] = useState(false)
  const [isPending, startTransition] = useTransition()

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setName('')
      setIsShared(false)
    }
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || isPending) return
    startTransition(async () => {
      try {
        const created = await createView({
          name: name.trim(),
          surface,
          filters,
          grouping: grouping ?? null,
          sorting: sorting ?? null,
          columnPrefs: columnPrefs ?? null,
          isShared,
        })
        toast.success(`Vista "${created.name}" guardada`)
        onSaved?.({ id: created.id, name: created.name })
        onOpenChange(false)
      } catch (err) {
        const { code, detail } = parseActionError(err)
        const msg =
          code === 'VIEW_NAME_DUPLICATE'
            ? `Ya existe una vista con ese nombre · ${detail}`
            : code === 'INVALID_GROUPING'
              ? `Agrupación inválida · ${detail}`
              : code === 'UNAUTHORIZED'
                ? 'Inicia sesión para guardar vistas'
                : `[${code}] ${detail}`
        toast.error(msg)
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
          data-testid="save-view-dialog"
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border bg-card p-5 shadow-2xl',
          )}
        >
          <form onSubmit={onSubmit}>
            <div className="mb-4 flex items-start justify-between gap-2">
              <Dialog.Title className="text-base font-semibold text-foreground">
                Guardar como…
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

            <div className="mb-3">
              <label
                htmlFor="saved-view-name"
                className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Nombre
              </label>
              <input
                id="saved-view-name"
                data-testid="save-view-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 120))}
                maxLength={120}
                placeholder="Ej. Mi backlog crítico"
                autoFocus
                disabled={isPending}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {name.length}/120
              </p>
            </div>

            <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                data-testid="save-view-shared-checkbox"
                checked={isShared}
                onChange={(e) => setIsShared(e.target.checked)}
                disabled={isPending}
                className="h-4 w-4 rounded border-border bg-background"
              />
              Compartir con todos
            </label>

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={isPending}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50"
                >
                  Cancelar
                </button>
              </Dialog.Close>
              <button
                type="submit"
                data-testid="save-view-confirm"
                disabled={isPending || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
