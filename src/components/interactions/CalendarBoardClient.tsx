'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Plus, Star } from 'lucide-react'
import { clsx } from 'clsx'
import type { SerializedTask } from '@/lib/types'
import { useUIStore } from '@/lib/stores/ui'
import { TaskFiltersBar } from './TaskFiltersBar'
import { EMPTY_TASK_FILTERS, filterTasks, type TaskFilters } from '@/lib/taskFilters'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'
import { QuickCreatePopover } from './QuickCreatePopover'
import { shiftTaskDates } from '@/lib/actions/schedule'
import { toast } from './Toaster'

type Props = {
  tasks: SerializedTask[]
  /** Primer día del mes visible, ISO. */
  monthStart: string
  /** Total de días del mes (28-31). */
  monthDays: number
  /** Nav month params. */
  prevMonthHref: string
  nextMonthHref: string
  monthLabel: string
  gerencias: { id: string; name: string }[]
  areas: { id: string; name: string; gerenciaId: string }[]
  projects: { id: string; name: string; areaId: string | null }[]
  users: { id: string; name: string }[]
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const PRIORITY_BORDER: Record<string, string> = {
  CRITICAL: 'border-l-red-500',
  HIGH: 'border-l-amber-500',
  MEDIUM: 'border-l-blue-500',
  LOW: 'border-l-slate-500',
}

const STATUS_DOT: Record<string, string> = {
  TODO: 'bg-slate-400',
  IN_PROGRESS: 'bg-indigo-500 animate-pulse',
  REVIEW: 'bg-amber-500',
  DONE: 'bg-emerald-500',
}

/** Paleta estable por projectId via hash de 8 colores */
function projectAccent(projectId: string | null | undefined): string {
  if (!projectId) return 'bg-slate-500/15'
  let h = 0
  for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) >>> 0
  const palette = [
    'bg-indigo-500/15',
    'bg-emerald-500/15',
    'bg-rose-500/15',
    'bg-amber-500/15',
    'bg-cyan-500/15',
    'bg-violet-500/15',
    'bg-teal-500/15',
    'bg-pink-500/15',
  ]
  return palette[h % palette.length]
}

/** YYYY-MM-DD en UTC */
function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Día ISO considerando solo la parte de fecha (local) */
function taskCoversDay(task: SerializedTask, day: Date): boolean {
  const dayKey = isoDay(day)
  const s = task.startDate ? task.startDate.slice(0, 10) : null
  const e = task.endDate ? task.endDate.slice(0, 10) : s
  if (!s || !e) return false
  return dayKey >= s && dayKey <= e
}

function parseActionError(err: unknown): { code: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
  return m ? { code: m[1], detail: m[2] } : { code: 'UNKNOWN', detail: msg }
}

export function CalendarBoardClient({
  tasks,
  monthStart,
  monthDays,
  prevMonthHref,
  nextMonthHref,
  monthLabel,
  gerencias,
  areas,
  projects,
  users,
}: Props) {
  const start = useMemo(() => new Date(monthStart), [monthStart])
  const [local, setLocal] = useState(tasks)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setLocal(tasks), [tasks])

  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)
  const [quickCreate, setQuickCreate] = useState<{ open: boolean; date: string | null }>({
    open: false,
    date: null,
  })
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [hoverDay, setHoverDay] = useState<string | null>(null)

  const drawerTaskId = useUIStore((s) => s.drawerTaskId)
  const openDrawer = useUIStore((s) => s.openDrawer)

  const filtered = useMemo(() => filterTasks(local, filters), [local, filters])

  const drawerTask = useMemo(
    () => local.find((t) => t.id === drawerTaskId) ?? null,
    [local, drawerTaskId],
  )

  // Construye la grilla: semanas completas desde el lunes previo al 1° hasta
  // el domingo siguiente al último día del mes. Grid 7 columnas × N filas.
  const cells = useMemo(() => {
    const year = start.getUTCFullYear()
    const month = start.getUTCMonth()
    const firstDow = (start.getUTCDay() + 6) % 7 // 0=Lun, 6=Dom
    const firstCell = new Date(Date.UTC(year, month, 1 - firstDow))
    const out: Date[] = []
    const totalCells = Math.ceil((firstDow + monthDays) / 7) * 7
    for (let i = 0; i < totalCells; i++) {
      out.push(new Date(Date.UTC(year, month, 1 - firstDow + i)))
    }
    return out
  }, [start, monthDays])

  // Index: fecha-iso → tareas del día
  const tasksByDay = useMemo(() => {
    const map = new Map<string, SerializedTask[]>()
    for (const t of filtered) {
      for (const cell of cells) {
        if (taskCoversDay(t, cell)) {
          const key = isoDay(cell)
          if (!map.has(key)) map.set(key, [])
          map.get(key)!.push(t)
        }
      }
    }
    return map
  }, [filtered, cells])

  const todayKey = isoDay(new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  )))

  const openQuickCreate = useCallback((day: Date) => {
    setQuickCreate({ open: true, date: isoDay(day) })
  }, [])

  // ────────── Drag & Drop (HTML5 API, pointer-friendly) ───────────
  function handleDragStart(e: React.DragEvent<HTMLButtonElement>, taskId: string) {
    e.dataTransfer.setData('text/plain', taskId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingTaskId(taskId)
  }
  function handleDragEnd() {
    setDraggingTaskId(null)
    setHoverDay(null)
  }
  function handleDragOver(e: React.DragEvent<HTMLDivElement>, dayKey: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (hoverDay !== dayKey) setHoverDay(dayKey)
  }
  async function handleDrop(
    e: React.DragEvent<HTMLDivElement>,
    dayKey: string,
  ) {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('text/plain')
    setHoverDay(null)
    setDraggingTaskId(null)
    if (!taskId) return

    const task = local.find((t) => t.id === taskId)
    if (!task || !task.startDate) return
    const fromKey = task.startDate.slice(0, 10)
    if (fromKey === dayKey) return

    // delta en días
    const deltaDays =
      (Date.UTC(
        Number(dayKey.slice(0, 4)),
        Number(dayKey.slice(5, 7)) - 1,
        Number(dayKey.slice(8, 10)),
      ) -
        Date.UTC(
          Number(fromKey.slice(0, 4)),
          Number(fromKey.slice(5, 7)) - 1,
          Number(fromKey.slice(8, 10)),
        )) /
      86_400_000

    // Optimistic
    const snapshot = local
    setLocal((prev) =>
      prev.map((t) =>
        t.id !== taskId
          ? t
          : {
              ...t,
              startDate: t.startDate
                ? new Date(new Date(t.startDate).getTime() + deltaDays * 86_400_000).toISOString()
                : null,
              endDate: t.endDate
                ? new Date(new Date(t.endDate).getTime() + deltaDays * 86_400_000).toISOString()
                : null,
            },
      ),
    )

    try {
      await shiftTaskDates(taskId, deltaDays)
      const sign = deltaDays > 0 ? '+' : ''
      toast.success(`Movida ${sign}${deltaDays} día${Math.abs(deltaDays) !== 1 ? 's' : ''}`)
    } catch (err) {
      const { code, detail } = parseActionError(err)
      toast.error(code === 'DEPENDENCY_VIOLATION' ? `Dependencia · ${detail}` : detail)
      setLocal(snapshot)
    }
  }

  const totalCount = filtered.length

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-card/40 px-6 py-3">
        <TaskFiltersBar
          value={filters}
          onChange={setFilters}
          gerencias={gerencias}
          areas={areas}
          projects={projects}
          users={users}
          show={{
            gerenciaId: true,
            areaId: true,
            projectId: true,
            priority: true,
            status: true,
            assigneeId: true,
            type: false,
          }}
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {totalCount} {totalCount === 1 ? 'actividad' : 'actividades'} en el mes
          </span>
          <div className="flex items-center rounded-md bg-muted p-1">
            <Link
              href={prevMonthHref}
              aria-label="Mes anterior"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="flex items-center gap-2 px-3 text-sm font-medium capitalize text-foreground">
              {monthLabel}
            </span>
            <Link
              href={nextMonthHref}
              aria-label="Mes siguiente"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Encabezado de días */}
      <div className="grid grid-cols-7 border-b border-border bg-card/20 text-center">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="border-r border-border/60 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground last:border-r-0"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Grid de celdas */}
      <div
        role="grid"
        aria-label={`Calendario ${monthLabel}`}
        className="grid flex-1 grid-cols-7 overflow-auto"
      >
        {cells.map((day, i) => {
          const dayKey = isoDay(day)
          const isCurrentMonth = day.getUTCMonth() === start.getUTCMonth()
          const isWeekend = day.getUTCDay() === 0 || day.getUTCDay() === 6
          const isToday = dayKey === todayKey
          const dayTasks = tasksByDay.get(dayKey) ?? []
          const overflow = dayTasks.length - 2
          const isDropTarget = hoverDay === dayKey && !!draggingTaskId

          return (
            <div
              key={dayKey + i}
              role="gridcell"
              aria-label={`${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${dayTasks.length} ${dayTasks.length === 1 ? 'actividad' : 'actividades'}`}
              aria-selected={isToday}
              tabIndex={isCurrentMonth ? 0 : -1}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button[data-task]')) return
                openQuickCreate(day)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openQuickCreate(day)
                }
              }}
              onDragOver={(e) => handleDragOver(e, dayKey)}
              onDrop={(e) => handleDrop(e, dayKey)}
              className={clsx(
                'group relative min-h-[120px] cursor-pointer border-b border-r border-border/60 p-1.5 transition-colors last-of-type:border-r-0',
                isCurrentMonth ? 'bg-background' : 'bg-card/40 opacity-70',
                isWeekend && 'bg-card/30',
                isToday && 'bg-primary/5 ring-2 ring-inset ring-primary/60',
                isDropTarget && 'bg-primary/10 ring-2 ring-inset ring-primary',
                'hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-primary',
              )}
            >
              <header className="mb-1 flex items-center justify-between">
                <span
                  className={clsx(
                    'text-xs font-semibold tabular-nums',
                    isToday
                      ? 'rounded-full bg-primary px-1.5 text-primary-foreground'
                      : isCurrentMonth
                        ? 'text-foreground'
                        : 'text-muted-foreground',
                  )}
                >
                  {day.getUTCDate()}
                </span>

                <button
                  type="button"
                  aria-label="Crear actividad en este día"
                  onClick={(e) => {
                    e.stopPropagation()
                    openQuickCreate(day)
                  }}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary opacity-0 transition-opacity hover:bg-primary hover:text-primary-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </header>

              <div className="space-y-0.5">
                {dayTasks.slice(0, 2).map((task) => (
                  <TaskChip
                    key={task.id}
                    task={task}
                    onOpen={() => openDrawer(task.id)}
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragEnd={handleDragEnd}
                    dragging={draggingTaskId === task.id}
                  />
                ))}
                {overflow > 0 && (
                  <DayOverflowChip
                    tasks={dayTasks}
                    offset={2}
                    overflow={overflow}
                    onOpen={(id) => openDrawer(id)}
                  />
                )}
                {dayTasks.length === 0 && isCurrentMonth && (
                  <div className="pointer-events-none mt-4 flex items-center justify-center text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground/70">
                    Click para crear
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <QuickCreatePopover
        open={quickCreate.open}
        onOpenChange={(open) =>
          setQuickCreate((s) => ({ ...s, open, date: open ? s.date : null }))
        }
        date={quickCreate.date}
        projects={projects}
        users={users}
        defaultProjectId={filters.projectId ?? null}
      />

      <TaskDrawer>
        {drawerTask ? (
          <TaskDrawerContent
            task={drawerTask}
            projects={projects}
            users={users}
            allTasks={local}
          />
        ) : null}
      </TaskDrawer>
    </>
  )
}

function TaskChip({
  task,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  task: SerializedTask
  onOpen: () => void
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
  dragging: boolean
}) {
  const priorityBorder = PRIORITY_BORDER[task.priority] ?? 'border-l-slate-500'
  const statusDot = STATUS_DOT[task.status] ?? 'bg-slate-400'
  const accent = projectAccent(task.projectId)

  return (
    <button
      type="button"
      data-task={task.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      title={`${task.mnemonic ?? task.id.substring(0, 6)} · ${task.title}`}
      className={clsx(
        'flex w-full items-center gap-1.5 truncate rounded border-l-2 px-1.5 py-0.5 text-left text-[11px] font-medium text-foreground transition-all',
        priorityBorder,
        accent,
        'hover:brightness-125 focus-visible:outline-2 focus-visible:outline-primary',
        dragging && 'opacity-40',
      )}
    >
      {task.isMilestone ? (
        <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
      ) : (
        <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', statusDot)} />
      )}
      <span className="truncate">
        <span className="font-semibold text-muted-foreground">
          {task.mnemonic ?? task.id.substring(0, 6)}
        </span>{' '}
        · {task.title}
      </span>
    </button>
  )
}

function DayOverflowChip({
  tasks,
  offset,
  overflow,
  onOpen,
}: {
  tasks: SerializedTask[]
  offset: number
  overflow: number
  onOpen: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setExpanded((s) => !s)
        }}
        className="w-full rounded bg-muted px-1.5 py-0.5 text-left text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        + {overflow} más
      </button>
      {expanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-card p-1 shadow-xl"
        >
          {tasks.slice(offset).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setExpanded(false)
                onOpen(t.id)
              }}
              className="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left text-[11px] text-foreground hover:bg-accent"
            >
              <span className="font-semibold text-muted-foreground">
                {t.mnemonic ?? t.id.substring(0, 6)}
              </span>
              <span className="truncate">· {t.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
