'use client'

import { useState } from 'react'

interface FormValues {
  name: string
  workdays: number
  workdayHours: number
  isDefault: boolean
}

interface Props {
  initial?: Partial<FormValues>
  disabled?: boolean
  onSubmit: (values: FormValues) => void
  onCancel: () => void
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/**
 * Formulario calendar (crear/editar): name, workdays bitmask como 7 toggles
 * (Lun-Dom), workdayHours, isDefault.
 */
export function CalendarForm({ initial, disabled, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [workdays, setWorkdays] = useState<number>(initial?.workdays ?? 31)
  const [workdayHours, setWorkdayHours] = useState<number>(
    initial?.workdayHours ?? 8,
  )
  const [isDefault, setIsDefault] = useState<boolean>(
    initial?.isDefault ?? false,
  )

  const toggleDay = (bit: number) => {
    setWorkdays((prev) => prev ^ (1 << bit))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      workdays,
      workdayHours,
      isDefault,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="calendar-form">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Nombre
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder="Ej. México - Estándar"
          data-testid="cal-input-name"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          Días laborables
        </label>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, idx) => {
            const active = (workdays & (1 << idx)) !== 0
            return (
              <button
                key={idx}
                type="button"
                disabled={disabled}
                onClick={() => toggleDay(idx)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
                    : 'border-border bg-background text-muted-foreground hover:border-border'
                }`}
                data-testid={`cal-day-${idx}`}
                aria-pressed={active}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Horas por día
          </label>
          <input
            type="number"
            min={0.5}
            max={24}
            step={0.5}
            value={workdayHours}
            onChange={(e) => setWorkdayHours(Number(e.target.value))}
            disabled={disabled}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-foreground/90">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              disabled={disabled}
              className="rounded border-border bg-background"
            />
            Por defecto
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/80 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={disabled || !name.trim()}
          className="rounded-md bg-indigo-500/30 border border-indigo-500/40 px-3 py-1.5 text-sm font-medium text-indigo-200 hover:bg-indigo-500/40 disabled:opacity-50"
          data-testid="cal-submit"
        >
          Guardar
        </button>
      </div>
    </form>
  )
}
