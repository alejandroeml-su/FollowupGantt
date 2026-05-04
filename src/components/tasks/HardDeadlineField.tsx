'use client'

/**
 * Equipo D2 · Campo `hardDeadline`.
 *
 * Vencimiento forzoso de la tarea (Ola P5 · Hard deadlines + Resource
 * Leveling). Si la EF de la tarea calculada por CPM rebasa esta fecha, se
 * reporta como violación en `/leveling`.
 *
 * Decisiones:
 *  - Componente CONTROLADO: el padre (TaskForm) mantiene el `value`. Esto
 *    permite que el form lo serialice a FormData sin DOM-walking.
 *  - Validación inline (no bloqueante): si la fecha es anterior a
 *    `startDate` mostramos un error visual; el server action es la fuente
 *    de verdad y volverá a validar cuando el feature flag de persistencia
 *    quede desplegado.
 *  - Sin `useEffect → setState` (React 19): el estado deriva de props.
 */

import { CalendarClock } from 'lucide-react'

interface Props {
  /** ISO YYYY-MM-DD o vacío. */
  value: string
  onChange: (next: string) => void
  /** Fecha de inicio actual de la tarea (YYYY-MM-DD) para validar consistencia. */
  startDate?: string | null
  disabled?: boolean
  /** Nombre del campo en FormData. */
  name?: string
  id?: string
}

const HELPER_TEXT =
  'Si se rebasa, la tarea aparece como violación en /leveling.'

export function HardDeadlineField({
  value,
  onChange,
  startDate,
  disabled = false,
  name = 'hardDeadline',
  id = 'task-hard-deadline',
}: Props) {
  const trimmedStart = (startDate ?? '').trim()
  const hasValue = value.trim() !== ''
  const violatesStart =
    hasValue && trimmedStart !== '' && value < trimmedStart

  return (
    <div className="space-y-1.5" data-testid="hard-deadline-field">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        Vencimiento forzoso
      </label>
      <input
        id={id}
        name={name}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={`${id}-help${violatesStart ? ` ${id}-error` : ''}`}
        aria-invalid={violatesStart || undefined}
        className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
      />
      <p
        id={`${id}-help`}
        className="text-[11px] text-muted-foreground"
      >
        {HELPER_TEXT}
      </p>
      {violatesStart && (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-[11px] text-destructive"
        >
          La fecha límite no puede ser anterior al inicio de la tarea
          ({trimmedStart}).
        </p>
      )}
    </div>
  )
}

export default HardDeadlineField
