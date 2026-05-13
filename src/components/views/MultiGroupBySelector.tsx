'use client'

/**
 * MultiGroupBySelector — selector múltiple de agrupación.
 *
 * Reemplaza al single-select `GroupBySelector` cuando la vista soporta
 * agrupación jerárquica (por uno o varios campos). El primer item de
 * `value` define el nivel raíz; los siguientes anidan dentro de cada
 * grupo del nivel previo.
 *
 * UX: trigger pequeño tipo chip muestra `N campos` o el label del
 * único campo seleccionado. Click abre un popover ligero con checkboxes
 * ordenados; el orden se preserva como aparecen en el array `value` y
 * el usuario puede reordenar implícitamente seleccionando/deseleccionando
 * (la última selección queda al final).
 *
 * El componente es stateless: el caller controla `value` y `onChange`
 * para que pueda persistirse en `useUIStore` o en una `SavedView`.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, Layers, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { GroupKey } from '@/lib/views/group-tasks'

export type GroupOption = {
  value: GroupKey
  label: string
}

const DEFAULT_OPTIONS: GroupOption[] = [
  { value: 'project', label: 'Proyecto' },
  { value: 'assignee', label: 'Responsable' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'phase', label: 'Fase' },
  { value: 'status', label: 'Estado' },
  { value: 'priority', label: 'Prioridad' },
  { value: 'tags', label: 'Etiquetas' },
]

type Props<T extends string = GroupKey> = {
  value: T[]
  onChange: (next: T[]) => void
  customFieldOptions?: ReadonlyArray<{ id: string; label: string }>
  /**
   * Permite a vistas no-List (Timeline, etc.) pasar su propio set de opciones
   * de agrupamiento sin acoplarse al `GroupKey` de SerializedTask. Si se
   * proporciona, sustituye al `DEFAULT_OPTIONS` (las customFieldOptions
   * siguen apilándose al final cuando se pasan).
   */
  options?: ReadonlyArray<{ value: T; label: string }>
  className?: string
}

export function MultiGroupBySelector<T extends string = GroupKey>({
  value,
  onChange,
  customFieldOptions = [],
  options: optionsProp,
  className,
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const baseOptions = (optionsProp ?? DEFAULT_OPTIONS) as ReadonlyArray<{
    value: T
    label: string
  }>
  const options: ReadonlyArray<{ value: T; label: string }> = [
    ...baseOptions,
    ...customFieldOptions.map((cf) => ({
      value: `custom_field:${cf.id}` as T,
      label: `Campo: ${cf.label}`,
    })),
  ]

  // Cerrar al click fuera.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const toggle = (key: T) => {
    if (value.includes(key)) {
      onChange(value.filter((k) => k !== key))
    } else {
      onChange([...value, key])
    }
  }

  const clear = () => onChange([])

  const triggerLabel =
    value.length === 0
      ? 'Sin agrupar'
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? value[0]
        : `${value.length} campos`

  return (
    <div
      ref={containerRef}
      className={clsx('relative inline-flex items-center gap-1.5', className)}
      data-testid="multi-group-by-selector"
    >
      <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="text-xs text-muted-foreground" aria-hidden>
        Agrupar por
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Seleccionar campos de agrupación"
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-secondary/50 focus:border-primary focus:outline-none"
      >
        <span>{triggerLabel}</span>
        {value.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              clear()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                clear()
              }
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Limpiar agrupación"
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md"
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Selecciona uno o varios
          </div>
          {options.map((o) => {
            const idx = value.indexOf(o.value)
            const checked = idx >= 0
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggle(o.value)}
                className={clsx(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-secondary',
                  checked && 'bg-secondary/60',
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'inline-flex h-3.5 w-3.5 items-center justify-center rounded border',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background',
                    )}
                  >
                    {checked && <Check className="h-2.5 w-2.5" />}
                  </span>
                  {o.label}
                </span>
                {checked && value.length > 1 && (
                  <span className="text-[10px] font-medium text-muted-foreground">
                    nivel {idx + 1}
                  </span>
                )}
              </button>
            )
          })}
          {value.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="mt-1 w-full rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-secondary"
            >
              Limpiar selección
            </button>
          )}
        </div>
      )}
    </div>
  )
}
