'use client'

import { useState, useTransition } from 'react'
import { addHoliday, removeHoliday } from '@/lib/actions/calendars'

interface HolidayRow {
  id: string
  date: string // ISO
  name: string
  recurring: boolean
}

interface Props {
  calendarId: string
  initial: HolidayRow[]
  onMutate?: () => void
}

/**
 * CRUD inline de festivos asociados a un WorkCalendar.
 * Lista + form para añadir nuevo (date, name, recurring).
 */
export function HolidaysList({ calendarId, initial, onMutate }: Props) {
  const [rows, setRows] = useState<HolidayRow[]>(initial)
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [recurring, setRecurring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!date || !name.trim()) return
    setError(null)
    startTransition(async () => {
      try {
        const created = await addHoliday(calendarId, date, name.trim(), recurring)
        setRows((prev) => [
          ...prev,
          {
            id: created.id,
            date: new Date(date).toISOString(),
            name: name.trim(),
            recurring,
          },
        ])
        setDate('')
        setName('')
        setRecurring(false)
        onMutate?.()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  const handleRemove = (id: string) => {
    setError(null)
    startTransition(async () => {
      try {
        await removeHoliday(id)
        setRows((prev) => prev.filter((r) => r.id !== id))
        onMutate?.()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  return (
    <div className="space-y-3" data-testid="holidays-list">
      <h4 className="text-sm font-medium text-white">Festivos</h4>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <ul className="space-y-1">
        {rows.length === 0 && (
          <li className="text-xs text-muted-foreground">Sin festivos.</li>
        )}
        {rows.map((h) => (
          <li
            key={h.id}
            className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
            data-testid={`holiday-row-${h.id}`}
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(h.date).toISOString().slice(0, 10)}
              </span>
              <span className="text-foreground/90">{h.name}</span>
              {h.recurring && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                  Anual
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleRemove(h.id)}
              disabled={isPending}
              className="text-xs text-red-300 hover:underline disabled:opacity-50"
            >
              Eliminar
            </button>
          </li>
        ))}
      </ul>

      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border bg-background/50 p-3"
      >
        <div>
          <label className="block text-[10px] uppercase text-muted-foreground mb-1">
            Fecha
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={isPending}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            data-testid="holiday-date"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[10px] uppercase text-muted-foreground mb-1">
            Nombre
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isPending}
            placeholder="Ej. Día de la Independencia"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            data-testid="holiday-name"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-foreground/90">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            disabled={isPending}
          />
          Anual
        </label>
        <button
          type="submit"
          disabled={isPending || !date || !name.trim()}
          className="rounded-md bg-indigo-500/30 border border-indigo-500/40 px-3 py-1 text-sm text-indigo-200 hover:bg-indigo-500/40 disabled:opacity-50"
          data-testid="holiday-add"
        >
          Añadir
        </button>
      </form>
    </div>
  )
}
