'use client'

/**
 * Ola P2 · Equipo P2-1 — Selector de agrupación dinámica.
 *
 * Dropdown para elegir el `groupBy` a aplicar en List/Kanban/Gantt. El
 * componente es **stateless**: el caller controla `value` y `onChange` para
 * que pueda persistirse en `useUIStore` o en una `SavedView`.
 */

import { Layers } from 'lucide-react'
import { clsx } from 'clsx'
import type { GroupKey } from '@/lib/views/group-tasks'

export type GroupOption = {
  value: GroupKey | ''
  label: string
}

const DEFAULT_OPTIONS: GroupOption[] = [
  { value: '', label: 'Sin agrupar' },
  { value: 'assignee', label: 'Responsable' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'phase', label: 'Fase' },
  { value: 'status', label: 'Estado' },
  { value: 'priority', label: 'Prioridad' },
  { value: 'tags', label: 'Etiquetas' },
]

type Props = {
  value: GroupKey | null
  onChange: (next: GroupKey | null) => void
  /**
   * Opciones extra de Custom Fields. Se concatenan al final del dropdown
   * con prefijo "Campo: <label>".
   */
  customFieldOptions?: ReadonlyArray<{ id: string; label: string }>
  className?: string
}

export function GroupBySelector({
  value,
  onChange,
  customFieldOptions = [],
  className,
}: Props) {
  const options: GroupOption[] = [
    ...DEFAULT_OPTIONS,
    ...customFieldOptions.map((cf) => ({
      value: `custom_field:${cf.id}` as GroupKey,
      label: `Campo: ${cf.label}`,
    })),
  ]

  return (
    <label
      className={clsx(
        'flex items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
      data-testid="group-by-selector"
    >
      <Layers className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">Agrupar por</span>
      <span aria-hidden>Agrupar por</span>
      <select
        value={value ?? ''}
        onChange={(e) => {
          const next = e.target.value
          onChange(next === '' ? null : (next as GroupKey))
        }}
        aria-label="Agrupar por"
        className="rounded-md border border-border bg-background py-1 px-2 text-xs text-foreground focus:border-primary focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value || '__none__'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
