'use client'

/**
 * Wave P9 follow-up — Date picker inline para fecha límite.
 *
 * Click en la celda muestra un input type="date" que dispara el cambio
 * al confirmar. El "Sin fecha" se muestra cuando endDate es null y
 * permite borrar con el botón X.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { Calendar, X as XIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { setTaskEndDate } from '@/lib/actions/inline-edit'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  taskId: string
  currentEndDate: string | null // ISO o null
  className?: string
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}

function formatDisplay(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function DueDateSelector({
  taskId,
  currentEndDate,
  className,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(toDateInputValue(currentEndDate))
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Sync interno cuando cambia la prop (tras revalidatePath del server).
  // Patrón prevValue para cumplir react-hooks/set-state-in-effect.
  const [prevDate, setPrevDate] = useState(currentEndDate)
  if (prevDate !== currentEndDate) {
    setPrevDate(currentEndDate)
    setValue(toDateInputValue(currentEndDate))
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.showPicker?.()
    }
  }, [editing])

  const persist = (newValue: string | null) => {
    if ((newValue ?? '') === toDateInputValue(currentEndDate)) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      try {
        await setTaskEndDate(taskId, newValue)
        toast.success(newValue ? 'Fecha actualizada' : 'Fecha removida')
        setEditing(false)
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Error al cambiar fecha',
        )
        setValue(toDateInputValue(currentEndDate))
        setEditing(false)
      }
    })
  }

  if (editing) {
    return (
      <div
        className={clsx('flex items-center gap-1', className)}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="date"
          value={value}
          disabled={isPending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => persist(value || null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              persist(value || null)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setValue(toDateInputValue(currentEndDate))
              setEditing(false)
            }
          }}
          className="rounded border border-border bg-input px-1 py-0.5 text-xs text-input-foreground focus:border-primary focus:outline-none"
        />
        {currentEndDate && (
          <button
            type="button"
            onClick={() => persist(null)}
            disabled={isPending}
            aria-label="Quitar fecha"
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-rose-400"
          >
            <XIcon className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      disabled={isPending}
      className={clsx(
        'flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary/60',
        isPending && 'opacity-60',
        className,
      )}
    >
      <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span
        className={clsx(
          currentEndDate ? 'text-foreground/90' : 'italic text-muted-foreground',
        )}
      >
        {formatDisplay(currentEndDate)}
      </span>
    </button>
  )
}
