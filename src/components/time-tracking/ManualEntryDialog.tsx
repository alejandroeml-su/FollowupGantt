'use client'

/**
 * Diálogo para registrar una entrada manual de tiempo. Usa Radix
 * `<Dialog>` para consistencia con el resto del módulo de
 * interacciones (TaskDrawer, ImportPreviewDialog, etc.).
 */

import { useState, useTransition } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Plus, X } from 'lucide-react'
import { toast } from '@/components/interactions/Toaster'
import { createManualEntry } from '@/lib/actions/time-entries'

type Props = {
  taskId: string
  userId: string
  /** Hook para refrescar la lista de entries del padre. */
  onCreated?: () => void
}

function localDateTimeNow(): string {
  // <input type="datetime-local"> espera "YYYY-MM-DDTHH:mm" en hora
  // local sin sufijo Z. Construimos manualmente para evitar UTC.
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ManualEntryDialog({ taskId, userId, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [startedAt, setStartedAt] = useState<string>(localDateTimeNow())
  const [endedAt, setEndedAt] = useState<string>(localDateTimeNow())
  const [description, setDescription] = useState<string>('')
  const [pending, startTx] = useTransition()

  function reset() {
    setStartedAt(localDateTimeNow())
    setEndedAt(localDateTimeNow())
    setDescription('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const start = new Date(startedAt)
    const end = new Date(endedAt)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error('Fechas inválidas')
      return
    }
    if (end.getTime() <= start.getTime()) {
      toast.error('La fecha de fin debe ser posterior al inicio')
      return
    }
    startTx(async () => {
      try {
        await createManualEntry({
          userId,
          taskId,
          startedAt: start,
          endedAt: end,
          description: description.trim() || null,
        })
        toast.success('Registro creado')
        setOpen(false)
        reset()
        onCreated?.()
      } catch (err) {
        toast.error((err as Error).message)
      }
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary"
          data-testid="manual-entry-trigger"
        >
          <Plus className="h-3 w-3" aria-hidden /> Entrada manual
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-4 shadow-xl outline-none"
          aria-describedby={undefined}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold">
              Nueva entrada manual
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Cerrar"
                className="rounded p-1 hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">Inicio</span>
              <input
                type="datetime-local"
                required
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">Fin</span>
              <input
                type="datetime-local"
                required
                value={endedAt}
                onChange={(e) => setEndedAt(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">
                Descripción (opcional)
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={2}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
                placeholder="¿Qué trabajaste en este intervalo?"
              />
            </label>

            <div className="mt-2 flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                  disabled={pending}
                >
                  Cancelar
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {pending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
