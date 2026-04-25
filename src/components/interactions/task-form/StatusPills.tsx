'use client'

import { useRef } from 'react'
import { clsx } from 'clsx'
import type { TaskStatus } from '@prisma/client'

type Option = {
  value: TaskStatus
  label: string
  /** Clases para el estado activo (border + bg + text). Tokens del DS Avante Neutral+. */
  activeClass: string
}

const OPTIONS: ReadonlyArray<Option> = [
  {
    value: 'TODO',
    label: 'To Do',
    activeClass: 'bg-secondary text-foreground border-border',
  },
  {
    value: 'IN_PROGRESS',
    label: 'In Progress',
    activeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  },
  {
    value: 'REVIEW',
    label: 'Review',
    activeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  },
  {
    value: 'DONE',
    label: 'Done',
    activeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  },
]

type Props = {
  value: TaskStatus
  onChange: (next: TaskStatus) => void
  ariaLabel?: string
  className?: string
}

/**
 * Grupo de 4 pills en grid 2x2 para Estado de la tarea.
 * A11y igual que PriorityPills (role="radiogroup", flechas, Home/End).
 *
 * Sprint 1 — Avante FollowupGantt.
 */
export function StatusPills({
  value,
  onChange,
  ariaLabel = 'Estado de la tarea',
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
      className={clsx('grid grid-cols-2 gap-1.5', className)}
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
              'w-full rounded-md border px-2 py-1.5 text-xs font-semibold transition-all',
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
