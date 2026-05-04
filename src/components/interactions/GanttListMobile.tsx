'use client'

import { useMemo } from 'react'
import { CalendarDays, Clock, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import type { SerializedTask } from '@/lib/types'
import { useUIStore } from '@/lib/stores/ui'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'

/**
 * Vista vertical de tareas para mobile (P4-3).
 *
 * En `<sm` el Gantt timeline es inusable (40 px/día → 1200 px de ancho
 * mínimo); en lugar de forzar scroll horizontal con barras micro,
 * mostramos una lista densa con la información clave: título, proyecto,
 * fechas, progreso y estado.
 *
 * Tap en una fila abre el TaskDrawer (que ya es full-screen en mobile,
 * `max-md:max-w-full`).
 */
export function GanttListMobile({
  tasks,
  rangeLabel,
  projects = [],
  users = [],
  allTasks,
}: {
  tasks: SerializedTask[]
  rangeLabel?: string
  projects?: { id: string; name: string }[]
  users?: { id: string; name: string }[]
  allTasks?: SerializedTask[]
}) {
  const openDrawer = useUIStore((s) => s.openDrawer)
  const drawerTaskId = useUIStore((s) => s.drawerTaskId)

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const da = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER
      const db = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER
      return da - db
    })
  }, [tasks])

  const drawerTask = useMemo(
    () => sorted.find((t) => t.id === drawerTaskId) ?? null,
    [sorted, drawerTaskId],
  )

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <CalendarDays className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-foreground">Sin tareas en este periodo</p>
        {rangeLabel && (
          <p className="mt-1 text-xs text-muted-foreground capitalize">{rangeLabel}</p>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2 p-3" data-testid="gantt-list-mobile">
        {rangeLabel && (
          <div className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">
            {rangeLabel}
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {sorted.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => openDrawer(t.id)}
                className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-3 text-left shadow-sm transition-colors hover:bg-accent active:bg-accent min-h-[44px]"
                aria-label={`Abrir tarea ${t.title}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-medium text-foreground">
                    {t.mnemonic ? <span className="text-muted-foreground">{t.mnemonic} · </span> : null}
                    {t.title}
                  </span>
                  <StatusBadge status={t.status} />
                </div>

                {t.project?.name && (
                  <span className="truncate text-xs text-muted-foreground">{t.project.name}</span>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {(t.startDate || t.endDate) && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {formatRange(t.startDate, t.endDate)}
                    </span>
                  )}
                  {typeof t.progress === 'number' && (
                    <span className="flex items-center gap-1">
                      <span aria-hidden="true">·</span>
                      {Math.round(t.progress)}%
                    </span>
                  )}
                  {t.priority && t.priority !== 'NORMAL' && (
                    <span className="flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" aria-hidden="true" />
                      {t.priority.toLowerCase()}
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {typeof t.progress === 'number' && (
                  <div
                    className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={Math.round(t.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, t.progress))}%` }}
                    />
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Drawer compartido — full-screen en mobile gracias a max-md:max-w-full */}
      <TaskDrawer>
        {drawerTask ? (
          <TaskDrawerContent
            task={drawerTask}
            projects={projects}
            users={users}
            allTasks={allTasks ?? sorted}
          />
        ) : null}
      </TaskDrawer>
    </>
  )
}

function formatRange(start?: string | null, end?: string | null): string {
  const fmt = (iso?: string | null) => {
    if (!iso) return null
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  }
  const s = fmt(start)
  const e = fmt(end)
  if (s && e) return `${s} – ${e}`
  return s ?? e ?? ''
}

function StatusBadge({ status }: { status: string }) {
  const cls = clsx(
    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
    status === 'COMPLETED' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    status === 'IN_PROGRESS' && 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400',
    status === 'BLOCKED' && 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
    (status === 'TODO' || !status) && 'border-border bg-muted text-muted-foreground',
  )
  return <span className={cls}>{status?.replace('_', ' ').toLowerCase() || 'todo'}</span>
}
