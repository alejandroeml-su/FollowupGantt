'use client'

/**
 * Wave R5-Extended · CMDB avanzado · selector de transición de estado.
 *
 * Botón discreto que abre un mini-form para cambiar el `CIStatus` del CI
 * con una nota opcional. Las transiciones inválidas se rechazan en el
 * server (`[CONFLICT]`) y el mensaje del Error se muestra al usuario.
 *
 * Visible para cualquier usuario con visibilidad del CI; la auditoría
 * registra el actor (server-side, no hace falta gate client extra).
 */

import { useState, useTransition } from 'react'
import { ArrowRightCircle, Loader2 } from 'lucide-react'
import { updateCiStatus } from '@/lib/actions/cmdb'

type Status = 'PLANNED' | 'ACTIVE' | 'MAINTENANCE' | 'RETIRED' | 'INCIDENT'

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: 'PLANNED', label: 'Planeado' },
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'MAINTENANCE', label: 'Mantenimiento' },
  { value: 'INCIDENT', label: 'Con incidente' },
  { value: 'RETIRED', label: 'Retirado' },
]

type Props = {
  ciId: string
  currentStatus: Status
}

export function CIStatusChanger({ ciId, currentStatus }: Props) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState<Status>(currentStatus)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (to === currentStatus) {
      setError('Selecciona un estado distinto al actual')
      return
    }
    startTransition(() => {
      ;(async () => {
        try {
          await updateCiStatus({
            ciId,
            toStatus: to,
            note: note.trim() || null,
          })
          setOpen(false)
          setNote('')
          // El server hizo revalidatePath; basta con dejar que el caller
          // server-component se re-renderice al navegar (Next 16 auto).
          // Para reflejo inmediato sin navegación, recargamos:
          if (typeof window !== 'undefined') {
            window.location.reload()
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Error inesperado')
        }
      })()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-subtle"
      >
        <ArrowRightCircle className="h-3 w-3" /> Cambiar estado
      </button>
    )
  }

  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs">
      <h3 className="mb-2 font-semibold text-foreground">Cambiar estado</h3>
      <div className="space-y-2">
        <label className="block">
          <span className="mb-0.5 block font-medium text-muted-foreground">
            Nuevo estado
          </span>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value as Status)}
            disabled={pending}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-foreground"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {o.value === currentStatus ? ' (actual)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block font-medium text-muted-foreground">
            Nota (opcional)
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Ej. Ventana de mantenimiento sábado 21:00"
            disabled={pending}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-foreground"
          />
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-rose-200"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setError(null)
            }}
            disabled={pending}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-subtle disabled:opacity-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || to === currentStatus}
            className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
