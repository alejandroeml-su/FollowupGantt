'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  endSprint,
  removeTaskFromSprint,
  startSprint,
  type SprintSummary,
} from '@/lib/actions/sprints'
import type { BurndownPoint, VelocityPoint } from '@/lib/agile/burndown'
import BurndownChart from './BurndownChart'
import VelocityChart from './VelocityChart'

export interface SprintTask {
  id: string
  mnemonic: string | null
  title: string
  status: string
  priority: string
  storyPoints: number | null
  assignee: { id: string; name: string } | null
}

export interface SprintBoardClientProps {
  sprint: SprintSummary
  tasks: SprintTask[]
  burndown: BurndownPoint[]
  velocity: VelocityPoint[]
}

const COLUMNS: { id: string; label: string }[] = [
  { id: 'TODO', label: 'To Do' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'REVIEW', label: 'Review' },
  { id: 'DONE', label: 'Done' },
]

/**
 * SprintBoard kanban-style del sprint activo. Muestra:
 *  - Cabecera con métricas (capacity, completados, totalPoints).
 *  - Botones "Iniciar sprint" / "Cerrar sprint" según el estado.
 *  - 4 columnas TODO / IN_PROGRESS / REVIEW / DONE.
 *  - Charts de Burndown y Velocity.
 *
 * El DnD entre columnas se delega a la pantalla `/kanban` existente; aquí
 * sólo permitimos sacar tareas del sprint (botón "Quitar").
 */
export function SprintBoardClient({
  sprint,
  tasks,
  burndown,
  velocity,
}: SprintBoardClientProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const grouped = useMemo(() => {
    const map = new Map<string, SprintTask[]>(COLUMNS.map((c) => [c.id, []]))
    for (const t of tasks) {
      const bucket = map.get(t.status) ?? map.get('TODO')!
      bucket.push(t)
    }
    return map
  }, [tasks])

  const refresh = () => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  const handleStart = () => {
    setError(null)
    startTransition(async () => {
      try {
        await startSprint(sprint.id)
        refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleEnd = () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        '¿Cerrar este sprint? Se calculará la velocity y no podrás reactivarlo.',
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await endSprint(sprint.id)
        refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleRemove = (taskId: string) => {
    setError(null)
    startTransition(async () => {
      try {
        await removeTaskFromSprint(taskId)
        refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const isPlanning = sprint.status === 'PLANNING'
  const isActive = sprint.status === 'ACTIVE'
  const isCompleted = sprint.status === 'COMPLETED'

  return (
    <div data-testid="sprint-board" className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card/40 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">
              {sprint.name}
            </h2>
            <span
              data-testid="sprint-status-badge"
              className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                isActive
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : isCompleted
                    ? 'bg-slate-500/20 text-slate-300'
                    : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {sprint.status}
            </span>
          </div>
          {sprint.goal && (
            <p className="mt-1 text-xs text-muted-foreground">{sprint.goal}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span>
              Capacity:{' '}
              <span className="font-semibold text-foreground">
                {sprint.capacity ?? '—'}
              </span>
            </span>
            <span>
              Completados:{' '}
              <span className="font-semibold text-cyan-300">
                {sprint.completedPoints}
              </span>
              {' / '}
              <span className="font-semibold">{sprint.totalPoints}</span>
              {' pts'}
            </span>
            {sprint.velocityActual !== null && (
              <span>
                Velocity final:{' '}
                <span className="font-semibold text-emerald-300">
                  {sprint.velocityActual}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {isPlanning && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleStart}
              data-testid="sprint-start-btn"
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Iniciar sprint
            </button>
          )}
          {isActive && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleEnd}
              data-testid="sprint-end-btn"
              className="rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              Cerrar sprint
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Kanban del sprint */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const colTasks = grouped.get(col.id) ?? []
          return (
            <div
              key={col.id}
              data-testid={`sprint-col-${col.id}`}
              className="flex flex-col rounded-lg border border-border bg-card/30 p-3"
            >
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
                <span>{col.label}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                  {colTasks.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {colTasks.length === 0 ? (
                  <div className="rounded border border-dashed border-border/60 px-2 py-3 text-center text-[11px] text-muted-foreground">
                    Sin tareas
                  </div>
                ) : (
                  colTasks.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-md border border-border bg-background/60 p-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {t.mnemonic && (
                            <span className="mr-2 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {t.mnemonic}
                            </span>
                          )}
                          <span className="text-foreground">{t.title}</span>
                        </div>
                        <span
                          className="shrink-0 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300"
                          title="Puntos de historia"
                        >
                          {t.storyPoints ?? '?'}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{t.assignee?.name ?? 'Sin asignar'}</span>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleRemove(t.id)}
                          className="text-rose-400 hover:text-rose-300 disabled:opacity-50"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card/30 p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Burndown
          </h3>
          <BurndownChart data={burndown} />
        </div>
        <div className="rounded-lg border border-border bg-card/30 p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Velocity
          </h3>
          <VelocityChart data={velocity} />
        </div>
      </div>
    </div>
  )
}

export default SprintBoardClient
