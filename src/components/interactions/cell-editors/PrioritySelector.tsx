'use client'

/**
 * Wave P9 follow-up — Selector inline de Priority.
 *
 * Dropdown nativo (4 opciones). Persiste vía `setTaskPriority`.
 */

import { useTransition } from 'react'
import { Flag } from 'lucide-react'
import { clsx } from 'clsx'
import { setTaskPriority } from '@/lib/actions/inline-edit'
import { toast } from '@/components/interactions/Toaster'

const PRIORITIES = [
  { value: 'LOW', label: 'Baja', color: 'text-blue-400' },
  { value: 'MEDIUM', label: 'Media', color: 'text-amber-400' },
  { value: 'HIGH', label: 'Alta', color: 'text-rose-400' },
  { value: 'CRITICAL', label: 'Crítica', color: 'text-red-500' },
] as const

type Priority = (typeof PRIORITIES)[number]['value']

type Props = {
  taskId: string
  currentPriority: string
  className?: string
}

export function PrioritySelector({
  taskId,
  currentPriority,
  className,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const current =
    PRIORITIES.find((p) => p.value === currentPriority) ?? PRIORITIES[1]

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Priority
    if (next === currentPriority) return
    startTransition(async () => {
      try {
        await setTaskPriority(taskId, next)
        toast.success('Prioridad actualizada')
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Error al cambiar prioridad',
        )
      }
    })
  }

  return (
    <div
      className={clsx('flex items-center gap-1.5', className)}
      onClick={(e) => e.stopPropagation()}
    >
      <Flag className={clsx('h-4 w-4', current.color)} />
      <select
        value={currentPriority}
        onChange={handleChange}
        disabled={isPending}
        aria-label="Prioridad"
        className={clsx(
          'cursor-pointer bg-transparent text-xs font-medium text-foreground/90 outline-none hover:text-foreground',
          isPending && 'opacity-60',
        )}
      >
        {PRIORITIES.map((p) => (
          <option
            key={p.value}
            value={p.value}
            className="bg-card text-foreground"
          >
            {p.label}
          </option>
        ))}
      </select>
    </div>
  )
}
