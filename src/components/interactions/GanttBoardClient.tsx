'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import type { SerializedTask } from '@/lib/types'
import { updateTaskDates, shiftTaskDates } from '@/lib/actions/schedule'
import { useHorizontalDrag } from '@/lib/hooks/useHorizontalDrag'
import { TaskWithContextMenu } from './TaskContextMenuItems'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'
import { useUIStore } from '@/lib/stores/ui'
import { useTaskShortcuts } from '@/lib/hooks/useTaskShortcuts'
import { toast } from './Toaster'

type Props = {
  tasks: SerializedTask[]
  /** Primera fecha visible (UTC, inclusive) */
  rangeStart: string
  /** Días a mostrar */
  rangeDays: number
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
}

const DAY_WIDTH = 40 // px por día — balance legibilidad / densidad

function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function daysBetween(from: Date, to: Date): number {
  const MS = 86_400_000
  return Math.round(
    (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) /
      MS,
  )
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function announce(msg: string) {
  const region = document.getElementById('a11y-live')
  if (region) {
    region.textContent = ''
    setTimeout(() => (region.textContent = msg), 20)
  }
}

function parseActionError(err: unknown): { code: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
  return m ? { code: m[1], detail: m[2] } : { code: 'UNKNOWN', detail: msg }
}

export function GanttBoardClient({
  tasks,
  rangeStart,
  rangeDays,
  projects,
  users,
}: Props) {
  const start = useMemo(() => new Date(rangeStart), [rangeStart])
  const days = useMemo(
    () =>
      Array.from({ length: rangeDays }, (_, i) => {
        const d = addDays(start, i)
        return d
      }),
    [start, rangeDays],
  )

  const [local, setLocal] = useState(tasks)
  // Re-sync con el snapshot del server tras revalidatePath (patrón RSC).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(tasks)
  }, [tasks])

  const [focusedId, setFocusedId] = useState<string | null>(local[0]?.id ?? null)
  const orderedIds = useMemo(() => local.map((t) => t.id), [local])

  const drawerTaskId = useUIStore((s) => s.drawerTaskId)
  const drawerTask = useMemo(
    () => local.find((t) => t.id === drawerTaskId) ?? null,
    [local, drawerTaskId],
  )

  useTaskShortcuts({
    focusedTaskId: focusedId,
    orderedTaskIds: orderedIds,
    onFocus: setFocusedId,
  })

  // Keyboard shift/resize sobre la barra con foco
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!focusedId) return
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable)
          return
      }
      const task = local.find((t) => t.id === focusedId)
      if (!task) return
      const s = parseISO(task.startDate)
      const eD = parseISO(task.endDate)
      if (!s || !eD) return

      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (!dir) return

      // Shift = resize end date; Alt = resize start; sin modifier = shift ambos
      if (e.shiftKey) {
        e.preventDefault()
        commitDates(task.id, s, addDays(eD, dir), 'resize-end')
      } else if (e.altKey) {
        e.preventDefault()
        commitDates(task.id, addDays(s, dir), eD, 'resize-start')
      } else if (!e.ctrlKey && !e.metaKey) {
        // Evitar colisión con ArrowLeft/Right del shortcut hook (que usa up/down)
        e.preventDefault()
        commitShift(task.id, dir)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, local])

  async function commitShift(id: string, deltaDays: number) {
    // Optimista
    setLocal((prev) =>
      prev.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              startDate: t.startDate
                ? addDays(new Date(t.startDate), deltaDays).toISOString()
                : null,
              endDate: t.endDate
                ? addDays(new Date(t.endDate), deltaDays).toISOString()
                : null,
            },
      ),
    )
    try {
      await shiftTaskDates(id, deltaDays)
      const t = local.find((x) => x.id === id)
      const s = t && parseISO(t.startDate)
      const e = t && parseISO(t.endDate)
      announce(
        `Tarea desplazada ${deltaDays > 0 ? '+' : ''}${deltaDays} día${Math.abs(deltaDays) !== 1 ? 's' : ''}` +
          (s && e ? ` · ${fmt(addDays(s, deltaDays))} → ${fmt(addDays(e, deltaDays))}` : ''),
      )
    } catch (err) {
      const { code, detail } = parseActionError(err)
      toast.error(code === 'DEPENDENCY_VIOLATION' ? `Dependencia · ${detail}` : detail)
      setLocal(tasks)
    }
  }

  async function commitDates(
    id: string,
    startDate: Date,
    endDate: Date,
    kind: 'shift' | 'resize-start' | 'resize-end',
  ) {
    setLocal((prev) =>
      prev.map((t) =>
        t.id !== id
          ? t
          : {
              ...t,
              startDate: startDate.toISOString(),
              endDate: endDate.toISOString(),
            },
      ),
    )
    try {
      await updateTaskDates(id, startDate, endDate)
      announce(
        `${kind === 'resize-start' ? 'Inicio' : kind === 'resize-end' ? 'Fin' : 'Fechas'} ajustado: ${fmt(startDate)} → ${fmt(endDate)}`,
      )
    } catch (err) {
      const { code, detail } = parseActionError(err)
      toast.error(
        code === 'INVALID_RANGE'
          ? `Rango inválido · ${detail}`
          : code === 'DEPENDENCY_VIOLATION'
            ? `Dependencia · ${detail}`
            : detail,
      )
      setLocal(tasks)
    }
  }

  const totalWidth = rangeDays * DAY_WIDTH

  return (
    <>
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 shadow-sm">
        {/* Header: etiquetas de nombre + escala de días */}
        <div className="flex border-b border-slate-800">
          <div className="flex w-64 shrink-0 items-center border-r border-slate-800 bg-slate-900 p-4 text-sm font-medium text-slate-300">
            Nombre de la Tarea
          </div>
          <div
            className="flex overflow-x-auto bg-slate-950/50"
            style={{ minWidth: totalWidth }}
          >
            {days.map((d) => {
              const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
              return (
                <div
                  key={d.toISOString()}
                  className={clsx(
                    'shrink-0 border-r border-slate-800/50 p-2 text-center text-[10px] font-medium uppercase',
                    isWeekend ? 'bg-slate-900/60 text-slate-600' : 'text-slate-500',
                  )}
                  style={{ width: DAY_WIDTH }}
                >
                  <div>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                  <div className="text-slate-400">{d.getUTCDate()}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Filas de tareas */}
        <div className="divide-y divide-slate-800/50">
          {local.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No hay tareas planificadas en este rango.
            </div>
          )}
          {local.map((task) => (
            <GanttRow
              key={task.id}
              task={task}
              focused={focusedId === task.id}
              onFocus={() => setFocusedId(task.id)}
              rangeStart={start}
              rangeDays={rangeDays}
              totalWidth={totalWidth}
              onShift={(delta) => commitShift(task.id, delta)}
              onResizeStart={(delta) => {
                const s = parseISO(task.startDate)
                const e = parseISO(task.endDate)
                if (!s || !e) return
                commitDates(task.id, addDays(s, delta), e, 'resize-start')
              }}
              onResizeEnd={(delta) => {
                const s = parseISO(task.startDate)
                const e = parseISO(task.endDate)
                if (!s || !e) return
                commitDates(task.id, s, addDays(e, delta), 'resize-end')
              }}
            />
          ))}
        </div>
      </div>

      <TaskDrawer
        breadcrumbs={
          drawerTask ? (
            <>
              {drawerTask.project?.name}
              {' › '}
              <span className="text-slate-300">
                #{drawerTask.id.substring(0, 6)}
              </span>
            </>
          ) : null
        }
        onNext={() => {
          if (!drawerTaskId) return
          const i = orderedIds.indexOf(drawerTaskId)
          const n = orderedIds[i + 1]
          if (n) useUIStore.getState().openDrawer(n)
        }}
        onPrev={() => {
          if (!drawerTaskId) return
          const i = orderedIds.indexOf(drawerTaskId)
          const p = orderedIds[i - 1]
          if (p) useUIStore.getState().openDrawer(p)
        }}
      >
        {drawerTask ? (
          <TaskDrawerContent 
            task={drawerTask} 
            projects={projects} 
            users={users} 
          />
        ) : null}
      </TaskDrawer>
    </>
  )
}

// ─────────────────── Row ────────────────────────────────────────

function GanttRow({
  task,
  focused,
  onFocus,
  rangeStart,
  rangeDays,
  totalWidth,
  onShift,
  onResizeStart,
  onResizeEnd,
}: {
  task: SerializedTask
  focused: boolean
  onFocus: () => void
  rangeStart: Date
  rangeDays: number
  totalWidth: number
  onShift: (deltaDays: number) => void
  onResizeStart: (deltaDays: number) => void
  onResizeEnd: (deltaDays: number) => void
}) {
  const s = parseISO(task.startDate)
  const e = parseISO(task.endDate)
  const hasDates = !!s && !!e

  // Px desde rangeStart
  const startDay = s ? Math.max(0, daysBetween(rangeStart, s)) : null
  const endDay = e
    ? Math.min(rangeDays, daysBetween(rangeStart, e) + 1)
    : null
  const left = startDay != null ? startDay * DAY_WIDTH : 0
  const width =
    startDay != null && endDay != null
      ? Math.max(DAY_WIDTH, (endDay - startDay) * DAY_WIDTH)
      : 0

  const bodyRef = useRef<HTMLDivElement>(null)
  const openDrawer = useUIStore((st) => st.openDrawer)

  const bodyDrag = useHorizontalDrag({
    dayWidth: DAY_WIDTH,
    onCommit: (deltaDays) => {
      if (deltaDays) onShift(deltaDays)
    },
  })
  const leftDrag = useHorizontalDrag({
    dayWidth: DAY_WIDTH,
    onCommit: (deltaDays) => {
      if (deltaDays) onResizeStart(deltaDays)
    },
  })
  const rightDrag = useHorizontalDrag({
    dayWidth: DAY_WIDTH,
    onCommit: (deltaDays) => {
      if (deltaDays) onResizeEnd(deltaDays)
    },
  })

  const isMilestone = !!task.isMilestone
  const progress = task.progress ?? 0

  return (
    <TaskWithContextMenu ctx={{ taskId: task.id }}>
      <div
        className={clsx(
          'group flex transition-colors',
          focused ? 'bg-slate-800/60' : 'hover:bg-slate-800/30',
        )}
        onClick={onFocus}
      >
        <div className="flex w-64 shrink-0 items-center gap-3 border-r border-slate-800 p-4">
          <div
            className={clsx(
              'h-2 w-2 rounded-full',
              task.type === 'PMI_TASK' ? 'bg-emerald-500' : 'bg-indigo-500',
            )}
          />
          <span
            className="truncate text-sm font-medium text-slate-300 group-hover:text-white"
            title={task.title}
          >
            {task.title}
          </span>
          {(task.comments?.length ?? 0) > 0 && (
            <span className="flex flex-shrink-0 items-center gap-0.5 text-[10px] text-slate-500">
              <MessageSquare className="h-3 w-3" />
              {task.comments?.length}
            </span>
          )}
        </div>

        <div
          className="relative flex-1 p-2"
          style={{ minWidth: totalWidth }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            openDrawer(task.id)
          }}
        >
          {/* grid columnas */}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex">
            {Array.from({ length: rangeDays }).map((_, i) => (
              <div
                key={i}
                className="shrink-0 border-r border-slate-800/30"
                style={{ width: DAY_WIDTH }}
              />
            ))}
          </div>

          {!hasDates && (
            <div className="relative z-10 inline-flex items-center rounded border border-dashed border-slate-700 px-2 py-1 text-xs text-slate-500">
              Sin fechas
            </div>
          )}

          {hasDates && !isMilestone && (
            <div
              ref={bodyRef}
              role="slider"
              tabIndex={0}
              aria-label={`Barra de ${task.title}`}
              aria-valuemin={0}
              aria-valuemax={rangeDays}
              aria-valuenow={startDay ?? 0}
              aria-valuetext={`${fmt(s)} a ${fmt(e)}`}
              onFocus={onFocus}
              style={{
                left,
                width,
                transform: bodyDrag.isDragging
                  ? `translateX(${bodyDrag.deltaPx}px)`
                  : undefined,
              }}
              className={clsx(
                'absolute top-1/2 z-10 h-6 -translate-y-1/2 overflow-hidden rounded-md shadow-sm',
                'flex cursor-grab active:cursor-grabbing',
                'border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
                task.type === 'PMI_TASK'
                  ? 'border-emerald-500/50 bg-emerald-900/40'
                  : 'border-indigo-500/50 bg-indigo-900/40',
                focused && 'ring-2 ring-indigo-500/60',
                bodyDrag.isDragging && 'opacity-80',
              )}
              {...bodyDrag.dragProps}
            >
              {/* progreso */}
              <div
                className={clsx(
                  'h-full transition-all',
                  task.type === 'PMI_TASK' ? 'bg-emerald-500' : 'bg-indigo-500',
                )}
                style={{ width: `${progress}%` }}
              />

              {/* handle izquierdo */}
              <div
                role="button"
                aria-label="Redimensionar inicio"
                className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/10 hover:bg-white/20"
                {...leftDrag.dragProps}
                onClick={(e) => e.stopPropagation()}
              />
              {/* handle derecho */}
              <div
                role="button"
                aria-label="Redimensionar fin"
                className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/10 hover:bg-white/20"
                {...rightDrag.dragProps}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {hasDates && isMilestone && (
            <div
              role="img"
              aria-label={`Hito ${task.title} el ${fmt(s)}`}
              tabIndex={0}
              onFocus={onFocus}
              style={{
                left: left + DAY_WIDTH / 2 - 8,
                transform: bodyDrag.isDragging
                  ? `translateX(${bodyDrag.deltaPx}px) rotate(45deg)`
                  : 'rotate(45deg)',
              }}
              className={clsx(
                'absolute top-1/2 z-10 h-4 w-4 -translate-y-1/2 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.4)]',
                focused && 'ring-2 ring-amber-300',
              )}
              title={task.title}
              {...bodyDrag.dragProps}
            />
          )}
        </div>
      </div>
    </TaskWithContextMenu>
  )
}
