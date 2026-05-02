'use client'

import { useState, useTransition } from 'react'
import { CalendarForm } from './CalendarForm'
import { HolidaysList } from './HolidaysList'
import {
  createCalendar,
  deleteCalendar,
  updateCalendar,
} from '@/lib/actions/calendars'
import type { getCalendarsForOrg } from '@/lib/actions/calendars'

type Calendar = Awaited<ReturnType<typeof getCalendarsForOrg>>[number]

interface Props {
  initialCalendars: Calendar[]
}

export function CalendarsAdmin({ initialCalendars }: Props) {
  const [calendars, setCalendars] = useState(initialCalendars)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const refresh = () => {
    // Soft-refresh: recargar la página para tomar nuevos datos del server.
    if (typeof window !== 'undefined') window.location.reload()
  }

  const handleCreate = (input: {
    name: string
    workdays: number
    workdayHours: number
    isDefault: boolean
  }) => {
    setError(null)
    startTransition(async () => {
      try {
        await createCalendar(input)
        setShowCreate(false)
        refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleUpdate = (
    id: string,
    patch: Parameters<typeof updateCalendar>[1],
  ) => {
    setError(null)
    startTransition(async () => {
      try {
        await updateCalendar(id, patch)
        setEditingId(null)
        refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleDelete = (id: string) => {
    setError(null)
    if (!confirm('¿Eliminar este calendario? Esta acción no se puede deshacer.')) {
      return
    }
    startTransition(async () => {
      try {
        await deleteCalendar(id)
        setCalendars((prev) => prev.filter((c) => c.id !== id))
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="space-y-6" data-testid="calendars-admin">
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-white">
          {calendars.length} calendario(s) configurado(s)
        </h2>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          disabled={isPending}
          className="rounded-md bg-indigo-500/20 px-3 py-1.5 text-sm font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors disabled:opacity-50"
          data-testid="btn-new-calendar"
        >
          {showCreate ? 'Cancelar' : '+ Nuevo calendario'}
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Nuevo calendario</h3>
          <CalendarForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            disabled={isPending}
          />
        </div>
      )}

      {calendars.length === 0 && !showCreate && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          No hay calendarios laborales configurados aún.
        </div>
      )}

      {calendars.map((cal) => (
        <div
          key={cal.id}
          className="rounded-xl border border-border bg-card overflow-hidden"
          data-testid={`calendar-row-${cal.id}`}
        >
          <div className="flex items-center justify-between border-b border-border bg-secondary/30 p-4">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2">
                {cal.name}
                {cal.isDefault && (
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 uppercase">
                    Por defecto
                  </span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Workdays bitmask: {cal.workdays} · {cal.workdayHours}h/día ·{' '}
                {cal.holidays.length} festivos · {cal.projectCount} proyectos
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setEditingId((v) => (v === cal.id ? null : cal.id))
                }
                disabled={isPending}
                className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm text-foreground/90 hover:bg-secondary/80 transition disabled:opacity-50"
              >
                {editingId === cal.id ? 'Cerrar' : 'Editar'}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(cal.id)}
                disabled={isPending}
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20 transition disabled:opacity-50"
              >
                Eliminar
              </button>
            </div>
          </div>

          {editingId === cal.id && (
            <div className="space-y-4 p-4">
              <CalendarForm
                initial={{
                  name: cal.name,
                  workdays: cal.workdays,
                  workdayHours: cal.workdayHours,
                  isDefault: cal.isDefault,
                }}
                onSubmit={(input) => handleUpdate(cal.id, input)}
                onCancel={() => setEditingId(null)}
                disabled={isPending}
              />
              <HolidaysList
                calendarId={cal.id}
                initial={cal.holidays.map((h) => ({
                  ...h,
                  date:
                    h.date instanceof Date ? h.date.toISOString() : h.date,
                }))}
                onMutate={refresh}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
