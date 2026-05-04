'use client'

import { useState, useTransition } from 'react'
import { assignTaskToSprint } from '@/lib/actions/sprints'

export interface BacklogTask {
  id: string
  mnemonic: string | null
  title: string
  status: string
  priority: string
  storyPoints: number | null
}

export interface SprintBacklogProps {
  tasks: BacklogTask[]
  /** Sprint al que se moverán las tareas mediante el botón "Mover a sprint". */
  activeSprintId?: string | null
}

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  HIGH: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  MEDIUM: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  LOW: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
}

/**
 * Lista de tareas sin sprint (backlog del proyecto). Cada fila muestra
 * priority + storyPoints y, si hay un sprint activo, un botón "Mover a
 * sprint actual" que invoca `assignTaskToSprint`.
 */
export function SprintBacklog({ tasks, activeSprintId }: SprintBacklogProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleAssign = (taskId: string) => {
    if (!activeSprintId) return
    setError(null)
    startTransition(async () => {
      try {
        await assignTaskToSprint(taskId, activeSprintId)
        if (typeof window !== 'undefined') window.location.reload()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  if (tasks.length === 0) {
    return (
      <div
        data-testid="sprint-backlog-empty"
        className="rounded-lg border border-dashed border-border bg-card/30 p-6 text-sm text-muted-foreground"
      >
        El backlog está vacío. Crea tareas sin asignar a un sprint para verlas aquí.
      </div>
    )
  }

  return (
    <div data-testid="sprint-backlog" className="space-y-2">
      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}
      {tasks.map((t) => (
        <div
          key={t.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/40 px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {t.mnemonic && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                {t.mnemonic}
              </span>
            )}
            <span className="truncate text-sm text-foreground">{t.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                PRIORITY_COLORS[t.priority] ?? PRIORITY_COLORS.MEDIUM
              }`}
            >
              {t.priority}
            </span>
            <span
              className="min-w-[28px] rounded bg-indigo-500/20 px-1.5 py-0.5 text-center text-[11px] font-semibold text-indigo-300"
              title="Puntos de historia"
            >
              {t.storyPoints ?? '?'}
            </span>
            {activeSprintId && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleAssign(t.id)}
                className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Mover a sprint
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default SprintBacklog
