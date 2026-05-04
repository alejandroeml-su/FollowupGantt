'use client'

import { useState } from 'react'
import { FIBONACCI_STORY_POINTS } from '@/lib/agile/burndown'

/**
 * Mini-componente de selector Fibonacci para Story Points (Ola P2).
 *
 * Se usa en `TaskForm` para crear tareas con estimación, y opcionalmente
 * en el modal de detalle para editarlas. La opción "?" representa "sin
 * estimar" y se serializa como string vacío (`name="storyPoints"`).
 *
 * `defaultValue=null` ⇒ "?".
 */
export interface StoryPointsFieldProps {
  /** Valor inicial (controla el render del select). */
  defaultValue?: number | null
  /** Nombre del input (FormData). Default: "storyPoints". */
  name?: string
  /** Disabled state. */
  disabled?: boolean
  /** ID del input para asociar a un <label>. */
  id?: string
  /** Callback cuando el valor cambia. Recibe `null` para "?". */
  onChange?: (value: number | null) => void
}

export default function StoryPointsField({
  defaultValue = null,
  name = 'storyPoints',
  disabled = false,
  id,
  onChange,
}: StoryPointsFieldProps) {
  const [value, setValue] = useState<number | null>(defaultValue ?? null)

  const handleChange = (raw: string) => {
    const next = raw === '' ? null : Number(raw)
    const clean = next === null || Number.isFinite(next) ? next : null
    setValue(clean)
    onChange?.(clean)
  }

  return (
    <div className="flex flex-col">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-muted-foreground mb-1"
      >
        Puntos de historia
      </label>
      <select
        id={id}
        name={name}
        value={value === null ? '' : String(value)}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        data-testid="story-points-field"
        aria-label="Puntos de historia"
        className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">? (sin estimar)</option>
        {FIBONACCI_STORY_POINTS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  )
}
