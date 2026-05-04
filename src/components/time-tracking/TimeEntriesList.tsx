'use client'

/**
 * Lista de entries de tiempo de una tarea con duración y costo total.
 * Permite borrar entries individuales (delete con confirmación nativa).
 */

import { useState, useTransition } from 'react'
import { Trash2, User as UserIcon } from 'lucide-react'
import { toast } from '@/components/interactions/Toaster'
import {
  deleteEntry,
  type SerializedTimeEntry,
} from '@/lib/actions/time-entries'

type Props = {
  taskId: string
  entries: SerializedTimeEntry[]
  /** Mapa userId → name para presentar autor del entry. */
  userNames?: Record<string, string>
  /** Si true, muestra el botón borrar. */
  canDelete?: boolean
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function formatCost(cost: number | null): string {
  if (cost == null) return '—'
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cost)
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export function TimeEntriesList({
  taskId,
  entries: initialEntries,
  userNames = {},
  canDelete = true,
}: Props) {
  const [entries, setEntries] = useState(initialEntries)
  const [pending, startTx] = useTransition()
  void taskId

  const totalMinutes = entries
    .filter((e) => e.endedAt)
    .reduce((acc, e) => acc + e.durationMinutes, 0)
  const totalCost = entries
    .filter((e) => e.endedAt && e.cost != null)
    .reduce((acc, e) => acc + (e.cost ?? 0), 0)

  function handleDelete(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('¿Eliminar este registro de tiempo?')) {
      return
    }
    startTx(async () => {
      try {
        await deleteEntry({ id })
        setEntries((prev) => prev.filter((e) => e.id !== id))
        toast.success('Registro eliminado')
      } catch (e) {
        toast.error((e as Error).message)
      }
    })
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/40 px-3 py-6 text-center text-sm text-muted-foreground">
        Sin registros de tiempo
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-testid="time-entries-list">
      <div className="flex items-center justify-between rounded-md bg-secondary/40 px-3 py-1.5 text-xs font-medium">
        <span>Total: {formatDuration(totalMinutes)}</span>
        <span>Costo: {formatCost(totalCost)}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {entries.map((e) => {
          const isRunning = !e.endedAt
          const userName = userNames[e.userId] ?? e.userId.substring(0, 6)
          return (
            <li
              key={e.id}
              className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <UserIcon className="h-3 w-3" aria-hidden /> {userName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(e.startedAt)}
                    {e.endedAt ? ` → ${formatDateTime(e.endedAt)}` : ' (en curso)'}
                  </span>
                </div>
                {e.description ? (
                  <p className="text-xs text-foreground/80">{e.description}</p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-0.5 text-xs">
                <span
                  className={
                    isRunning
                      ? 'font-mono text-emerald-400'
                      : 'font-mono text-foreground'
                  }
                >
                  {isRunning ? '⏱' : formatDuration(e.durationMinutes)}
                </span>
                <span className="text-muted-foreground">{formatCost(e.cost)}</span>
              </div>
              {canDelete && !isRunning ? (
                <button
                  type="button"
                  onClick={() => handleDelete(e.id)}
                  disabled={pending}
                  className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  aria-label="Eliminar registro"
                  title="Eliminar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
