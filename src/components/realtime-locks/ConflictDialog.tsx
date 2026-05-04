'use client'

/**
 * Wave P6 · Equipo A5 — diálogo de resolución de conflicto post-save.
 *
 * Aparece cuando `useVersionCheck` indica `hasConflict=true` y el usuario
 * intentó guardar. Muestra un diff lado a lado *texto plano* (sin librería
 * de diff externa) con tres acciones:
 *
 *   - Mantener mi versión (sobrescribir BD con localValue → último-write-wins)
 *   - Aceptar versión remota (descarta cambios locales)
 *   - Cancelar (no guarda, deja al usuario seguir editando)
 *
 * El componente no llama server actions: delega via `onResolve(action)` para
 * que la página dueña de los datos haga el commit/discard según convenga.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X as CloseIcon } from 'lucide-react'
import { clsx } from 'clsx'
import type { ConflictResolution } from '@/lib/realtime-locks/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Etiqueta del campo en conflicto (ej. "Título", "Descripción"). */
  fieldLabel?: string
  /** Valor que el usuario tiene en su form. */
  localValue: string
  /** Valor recién llegado desde la BD. */
  remoteValue: string
  /** Nombre del usuario que guardó la versión remota (si conocido). */
  remoteAuthor?: string | null
  /**
   * Resolución del conflicto. Llamado al click en cualquiera de los tres
   * botones (también al cerrar = `'cancel'`).
   */
  onResolve: (action: ConflictResolution) => void
}

export function ConflictDialog({
  open,
  onOpenChange,
  fieldLabel,
  localValue,
  remoteValue,
  remoteAuthor,
  onResolve,
}: Props) {
  const handleClose = (next: boolean) => {
    if (!next) {
      onResolve('cancel')
    }
    onOpenChange(next)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="conflict-dialog"
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border bg-card p-5 shadow-2xl',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertTriangle
                aria-hidden
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
              />
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">
                  Cambios remotos detectados
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  {remoteAuthor
                    ? `${remoteAuthor} guardó cambios mientras editabas`
                    : 'Otro usuario guardó cambios mientras editabas'}
                  {fieldLabel ? ` · campo: ${fieldLabel}` : ''}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Cerrar"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <section
              data-testid="conflict-dialog-local"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
            >
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                Tu versión
              </h4>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
                {localValue || <span className="text-muted-foreground italic">(vacío)</span>}
              </pre>
            </section>

            <section
              data-testid="conflict-dialog-remote"
              className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3"
            >
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                Versión remota
              </h4>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
                {remoteValue || <span className="text-muted-foreground italic">(vacío)</span>}
              </pre>
            </section>
          </div>

          <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              data-testid="conflict-dialog-cancel"
              onClick={() => {
                onResolve('cancel')
                onOpenChange(false)
              }}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
            >
              Cancelar (no guardar)
            </button>
            <button
              type="button"
              data-testid="conflict-dialog-accept-remote"
              onClick={() => {
                onResolve('accept_remote')
                onOpenChange(false)
              }}
              className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-500/20"
            >
              Aceptar versión remota
            </button>
            <button
              type="button"
              data-testid="conflict-dialog-overwrite"
              onClick={() => {
                onResolve('overwrite')
                onOpenChange(false)
              }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Mantener mi versión (sobrescribir)
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
