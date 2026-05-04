'use client'

/**
 * Ola P2 · Equipo P2-3 — Dialog "Configurar Recurrencia".
 *
 * Lanzado desde el listado de templates o desde el TaskForm. Permite
 * configurar frequency / interval / weekday / endDate / count y muestra
 * un preview de las próximas 5 ocurrencias usando `previewOccurrences`
 * (cómputo client-side).
 */

import { useMemo, useState, useTransition } from 'react'
import { previewOccurrences, type RecurrenceFreq } from '@/lib/recurrence/rrule'
import { createRule } from '@/lib/actions/recurrence'

const WEEKDAYS = [
  { value: 0, label: 'Lun' },
  { value: 1, label: 'Mar' },
  { value: 2, label: 'Mié' },
  { value: 3, label: 'Jue' },
  { value: 4, label: 'Vie' },
  { value: 5, label: 'Sáb' },
  { value: 6, label: 'Dom' },
]

function todayIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10)
}

export function RecurrenceDialog({
  templateId,
  templateName,
  onClose,
}: {
  templateId: string
  templateName: string
  onClose: () => void
}) {
  const [frequency, setFrequency] = useState<RecurrenceFreq>('WEEKLY')
  const [interval, setIntervalValue] = useState<number>(1)
  const [byweekday, setByweekday] = useState<number[]>([])
  const [bymonthday, setBymonthday] = useState<string>('')
  const [startDate, setStartDate] = useState<string>(todayIso())
  const [endDate, setEndDate] = useState<string>('')
  const [count, setCount] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const preview = useMemo(() => {
    try {
      const start = new Date(startDate)
      if (Number.isNaN(start.getTime())) return []
      const monthDays = bymonthday
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31)
      const end = endDate ? new Date(endDate) : null
      const cnt = count ? Number.parseInt(count, 10) : null
      return previewOccurrences(
        {
          frequency,
          interval,
          byweekday: frequency === 'WEEKLY' ? byweekday : [],
          bymonthday:
            frequency === 'MONTHLY' || frequency === 'YEARLY' ? monthDays : [],
          startDate: start,
          endDate: end,
          count: cnt && cnt > 0 ? cnt : null,
        },
        5,
      )
    } catch {
      return []
    }
  }, [frequency, interval, byweekday, bymonthday, startDate, endDate, count])

  const toggleWeekday = (wd: number) => {
    setByweekday((prev) =>
      prev.includes(wd) ? prev.filter((x) => x !== wd) : [...prev, wd].sort(),
    )
  }

  const handleSave = () => {
    setError(null)
    startTransition(async () => {
      try {
        const monthDays = bymonthday
          .split(',')
          .map((s) => Number.parseInt(s.trim(), 10))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31)
        await createRule({
          templateId,
          frequency,
          interval,
          byweekday: frequency === 'WEEKLY' ? byweekday : [],
          bymonthday:
            frequency === 'MONTHLY' || frequency === 'YEARLY' ? monthDays : [],
          startDate,
          endDate: endDate || null,
          count: count ? Number.parseInt(count, 10) : null,
        })
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recurrence-dialog-title"
      data-testid="recurrence-dialog"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <header className="border-b border-gray-200 p-4 flex items-center justify-between">
          <div>
            <h2 id="recurrence-dialog-title" className="text-lg font-semibold">
              Configurar recurrencia
            </h2>
            <p className="text-xs text-gray-500">{templateName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>

        <div className="p-4 space-y-4">
          {error && (
            <div
              className="p-2 border border-red-300 bg-red-50 text-red-800 rounded text-sm"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Frecuencia</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurrenceFreq)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                data-testid="recurrence-frequency"
              >
                <option value="DAILY">Diaria</option>
                <option value="WEEKLY">Semanal</option>
                <option value="MONTHLY">Mensual</option>
                <option value="YEARLY">Anual</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Cada</label>
              <input
                type="number"
                min="1"
                max="999"
                value={interval}
                onChange={(e) => setIntervalValue(Number.parseInt(e.target.value, 10) || 1)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
          </div>

          {frequency === 'WEEKLY' && (
            <div>
              <label className="block text-sm font-medium mb-1">Días de la semana</label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleWeekday(d.value)}
                    className={`px-3 py-1 rounded text-xs border ${
                      byweekday.includes(d.value)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(frequency === 'MONTHLY' || frequency === 'YEARLY') && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Días del mes (separados por coma; ej. 1,15,30)
              </label>
              <input
                type="text"
                value={bymonthday}
                onChange={(e) => setBymonthday(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Fecha inicio</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Repetir hasta</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Máximo de ocurrencias (opcional)
            </label>
            <input
              type="number"
              min="1"
              max="5000"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>

          <div className="border-t border-gray-200 pt-3">
            <h3 className="text-sm font-semibold mb-2">Próximas ocurrencias</h3>
            <ul className="text-xs text-gray-600 space-y-1" data-testid="recurrence-preview">
              {preview.length === 0 && (
                <li className="italic">Configura la regla para ver el preview</li>
              )}
              {preview.map((d) => (
                <li key={d.toISOString()}>{d.toISOString().slice(0, 10)}</li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="border-t border-gray-200 p-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            data-testid="recurrence-save"
          >
            {isPending ? 'Guardando…' : 'Guardar regla'}
          </button>
        </footer>
      </div>
    </div>
  )
}
