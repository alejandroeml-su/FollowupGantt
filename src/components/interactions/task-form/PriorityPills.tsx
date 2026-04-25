'use client'

import { useRef } from 'react'
import { clsx } from 'clsx'

export type PriorityValue = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

type Option = {
  value: PriorityValue
  label: string
  /** Clases para el estado activo (border + bg + text). Tokens del DS Avante Neutral+. */
  activeClass: string
}

const OPTIONS: ReadonlyArray<Option> = [
  {
    value: 'LOW',
    label: 'Baja',
    activeClass: 'bg-secondary text-muted-foreground border-border',
  },
  {
    value: 'MEDIUM',
    label: 'Media',
    activeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  },
  {
    value: 'HIGH',
    label: 'Alta',
    activeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  },
  {
    value: 'CRITICAL',
    label: 'Crítica',
    activeClass: 'bg-red-500/15 text-red-300 border-red-500/40',
  },
]

type Props = {
  value: PriorityValue
  onChange: (next: PriorityValue) => void
  /** Etiqueta visible para lectores de pantalla del grupo. */
  ariaLabel?: string
  className?: string
}

/**
 * Grupo de 4 pills horizontales para Prioridad.
 * A11y:
 *   - role="radiogroup"
 *   - cada pill role="radio" con aria-checked
 *   - flechas izquierda/derecha (y arriba/abajo) ciclan la selección cuando el grupo tiene foco
 *   - Tab/Shift+Tab navega entre grupos (sólo el activo es tabbable)
 *
 * Sprint 1 — Avante FollowupGantt.
 */
export function PriorityPills({
  value,
  onChange,
  ariaLabel = 'Prioridad de la tarea',
  className,
}: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const focusIndex = (idx: number) => {
    const next = (idx + OPTIONS.length) % OPTIONS.length
    const el = refs.current[next]
    if (el) {
      el.focus()
      onChange(OPTIONS[next].value)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      focusIndex(currentIdx + 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      focusIndex(currentIdx - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusIndex(OPTIONS.length - 1)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={clsx('flex flex-wrap gap-1.5', className)}
    >
      {OPTIONS.map((opt, idx) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[idx] = el
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={clsx(
              'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? opt.activeClass
                : 'bg-transparent border-border text-muted-foreground hover:border-foreground/30',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
