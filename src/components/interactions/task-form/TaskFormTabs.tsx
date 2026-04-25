'use client'

import type { ComponentType, SVGProps } from 'react'

export type TaskFormTabId =
  | 'subtasks'
  | 'comments'
  | 'history'
  | 'attachments'
  | 'relations'
  // ids extras para el drawer (tab "detail" en TaskDrawerContent).
  | 'detail'
  | 'tracking'

export type TaskFormTab = {
  id: string
  label: string
  /** Conteo opcional al lado del label (subtareas, comentarios…). */
  count?: number
  /** Icono opcional (lucide o equivalente). */
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  /** Si true, el tab se renderiza en estado deshabilitado. */
  disabled?: boolean
  /** Tooltip nativo cuando el tab está deshabilitado. */
  disabledReason?: string
}

type Props = {
  tabs: TaskFormTab[]
  active: string
  onChange: (id: string) => void
  /** Clase opcional para el contenedor (override). */
  className?: string
}

/**
 * Barra de tabs reutilizable entre `TaskCreationModal` y `TaskDrawerContent`.
 *
 * Estilo replica el patrón existente del drawer (border-b, indigo-500 como
 * color activo) para evitar regresión visual al migrar Sprint 5.
 */
export function TaskFormTabs({ tabs, active, onChange, className }: Props) {
  return (
    <div
      role="tablist"
      className={
        className ??
        'flex border-b border-border overflow-x-auto scrollbar-none'
      }
    >
      {tabs.map((t) => {
        const isActive = t.id === active && !t.disabled
        const baseClasses =
          'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap'

        const stateClasses = t.disabled
          ? 'border-transparent text-muted-foreground/50 cursor-not-allowed'
          : isActive
            ? 'border-indigo-500 text-indigo-400'
            : 'border-transparent text-muted-foreground hover:text-foreground/90'

        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={t.disabled || undefined}
            tabIndex={t.disabled ? -1 : 0}
            title={t.disabled ? t.disabledReason : undefined}
            onClick={() => {
              if (t.disabled) return
              onChange(t.id)
            }}
            className={`${baseClasses} ${stateClasses}`}
          >
            {t.icon ? <t.icon className="h-4 w-4" aria-hidden="true" /> : null}
            <span>{t.label}</span>
            {typeof t.count === 'number' && t.count > 0 && (
              <span className="ml-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-foreground/80">
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
