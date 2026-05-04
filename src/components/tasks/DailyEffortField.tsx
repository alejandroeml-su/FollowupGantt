'use client'

/**
 * Equipo D2 · Campo `dailyEffortHours`.
 *
 * Estimación de horas/día por defecto que la tarea consume para el cálculo
 * de carga del recurso (assignee) en `/leveling` (Ola P5 · Resource
 * Leveling). Si NULL, el algoritmo asume `WorkCalendar.workdayHours` o 8h.
 *
 * Decisiones:
 *  - Controlado por el padre. Acepta string vacío para representar
 *    "sin valor" sin cambiar el contrato del padre (mantiene paridad con
 *    `plannedValue`/`actualCost` que también viajan como string).
 *  - Validación blanda: el `<input type="number">` con `min/max/step`
 *    cubre la mayoría de UX; el server action revalida.
 */

import { Clock4 } from 'lucide-react'

interface Props {
  /** String del valor (acepta vacío). */
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  name?: string
  id?: string
}

const HELPER_TEXT =
  'Usado para calcular carga de recursos en /leveling. Si lo dejas vacío, se asume el valor del calendario laboral o 8h.'

export function DailyEffortField({
  value,
  onChange,
  disabled = false,
  name = 'dailyEffortHours',
  id = 'task-daily-effort',
}: Props) {
  const numeric = value.trim() === '' ? null : Number(value)
  const isInvalid =
    numeric != null &&
    (!Number.isFinite(numeric) || numeric < 0 || numeric > 24)

  return (
    <div className="space-y-1.5" data-testid="daily-effort-field">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <Clock4 className="h-3.5 w-3.5" />
        Esfuerzo diario (horas)
      </label>
      <input
        id={id}
        name={name}
        type="number"
        min={0}
        max={24}
        step={0.5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="8"
        disabled={disabled}
        aria-describedby={`${id}-help${isInvalid ? ` ${id}-error` : ''}`}
        aria-invalid={isInvalid || undefined}
        className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
      />
      <p id={`${id}-help`} className="text-[11px] text-muted-foreground">
        {HELPER_TEXT}
      </p>
      {isInvalid && (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-[11px] text-destructive"
        >
          El valor debe estar entre 0 y 24 horas.
        </p>
      )}
    </div>
  )
}

export default DailyEffortField
