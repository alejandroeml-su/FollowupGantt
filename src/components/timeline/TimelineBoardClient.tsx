'use client'

/**
 * US-4.2 Timeline View — vista de línea de tiempo con zoom y agrupación.
 *
 * Diferenciación con Gantt:
 *   - Zoom continuo (semanas / meses / trimestres) en lugar de mes fijo
 *   - Agrupación vertical (Project / Epic / Sprint / Status / Assignee)
 *   - Barras read-only (click → drawer); sin drag-drop ni CPM
 *   - Densidad alta de información por slot (multi-año visible)
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronRight,
  Layers,
  Sparkles,
  User as UserIcon,
  Flag,
  Diamond,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useUIStore } from '@/lib/stores/ui'
import {
  buildTimelineWindow,
  taskBarGeometry,
  todayMarkerPct,
} from '@/lib/timeline/range'
import type {
  TimelineGroup,
  TimelineGroupBy,
  TimelineTask,
  TimelineZoom,
} from '@/lib/timeline/types'

type Props = {
  tasks: TimelineTask[]
  initialZoom?: TimelineZoom
  initialGroupBy?: TimelineGroupBy
}

const STATUS_TONE: Record<string, string> = {
  TODO: 'bg-slate-500',
  IN_PROGRESS: 'bg-indigo-500',
  REVIEW: 'bg-violet-500',
  DONE: 'bg-emerald-500',
}

const PRIORITY_BORDER: Record<string, string> = {
  CRITICAL: 'border-rose-400',
  HIGH: 'border-amber-400',
  MEDIUM: 'border-blue-400',
  LOW: 'border-slate-500',
}

const ZOOM_LABELS: Record<TimelineZoom, string> = {
  WEEKS: 'Semanas',
  MONTHS: 'Meses',
  QUARTERS: 'Trimestres',
}

const GROUPBY_LABELS: Record<TimelineGroupBy, string> = {
  PROJECT: 'Proyecto',
  EPIC: 'Epic',
  SPRINT: 'Sprint',
  STATUS: 'Estado',
  ASSIGNEE: 'Asignado',
}

function groupTasks(
  tasks: TimelineTask[],
  groupBy: TimelineGroupBy,
): TimelineGroup[] {
  const map = new Map<string, TimelineGroup>()

  for (const t of tasks) {
    let key: string
    let label: string
    let color: string | null = null

    switch (groupBy) {
      case 'PROJECT':
        key = t.projectId
        label = t.projectName
        break
      case 'EPIC':
        key = t.epicId ?? '__no_epic__'
        label = t.epicName ?? 'Sin Epic'
        color = t.epicColor
        break
      case 'SPRINT':
        key = t.sprintId ?? '__backlog__'
        label = t.sprintName ?? 'Sin Sprint (Backlog)'
        break
      case 'STATUS':
        key = t.status
        label = t.status
        break
      case 'ASSIGNEE':
        key = t.assignee?.id ?? '__unassigned__'
        label = t.assignee?.name ?? 'Sin asignar'
        break
    }

    if (!map.has(key)) {
      map.set(key, { key, label, color, tasks: [] })
    }
    map.get(key)!.tasks.push(t)
  }

  // Sort dentro de cada grupo: por startDate asc, luego por priority.
  const PRIORITY_ORDER: Record<string, number> = {
    CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
  }
  for (const g of map.values()) {
    g.tasks.sort((a, b) => {
      const sa = a.startDate ? new Date(a.startDate).getTime() : Infinity
      const sb = b.startDate ? new Date(b.startDate).getTime() : Infinity
      if (sa !== sb) return sa - sb
      const pa = PRIORITY_ORDER[a.priority] ?? 99
      const pb = PRIORITY_ORDER[b.priority] ?? 99
      return pa - pb
    })
  }

  // Sort de grupos: alfabético, "Sin..." al final.
  return Array.from(map.values()).sort((a, b) => {
    const aIsNone = a.key.startsWith('__')
    const bIsNone = b.key.startsWith('__')
    if (aIsNone !== bIsNone) return aIsNone ? 1 : -1
    return a.label.localeCompare(b.label, 'es-MX')
  })
}

export function TimelineBoardClient({
  tasks,
  initialZoom = 'MONTHS',
  initialGroupBy = 'PROJECT',
}: Props) {
  const [zoom, setZoom] = useState<TimelineZoom>(initialZoom)
  const [groupBy, setGroupBy] = useState<TimelineGroupBy>(initialGroupBy)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const openDrawer = useUIStore((s) => s.openDrawer)
  const router = useRouter()
  void router

  const win = useMemo(() => buildTimelineWindow(zoom), [zoom])
  const groups = useMemo(() => groupTasks(tasks, groupBy), [tasks, groupBy])
  const todayPct = useMemo(() => todayMarkerPct(win), [win])

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const totalTasksInRange = useMemo(() => {
    let count = 0
    for (const g of groups) {
      for (const t of g.tasks) {
        if (!t.startDate || !t.endDate) continue
        const geom = taskBarGeometry(
          new Date(t.startDate),
          new Date(t.endDate),
          win,
        )
        if (geom) count++
      }
    }
    return count
  }, [groups, win])

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar — Wave P16-C · stack vertical en mobile, padding compacto. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 md:gap-3 md:px-6 md:py-3">
        <div className="flex items-center gap-1.5">
          <CalendarIcon className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-semibold text-foreground">
            {win.label}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Zoom */}
          <div
            role="group"
            aria-label="Zoom"
            className="inline-flex overflow-hidden rounded-md border border-border bg-input"
          >
            {(['WEEKS', 'MONTHS', 'QUARTERS'] as const).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                aria-pressed={zoom === z}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium transition-colors',
                  zoom === z
                    ? 'bg-indigo-500 text-white'
                    : 'text-muted-foreground hover:bg-secondary/60',
                )}
              >
                {ZOOM_LABELS[z]}
              </button>
            ))}
          </div>

          {/* GroupBy */}
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as TimelineGroupBy)}
            aria-label="Agrupar por"
            className="rounded-md border border-border bg-input px-2 py-1 text-xs text-input-foreground focus:border-primary focus:outline-none"
          >
            {(['PROJECT', 'EPIC', 'SPRINT', 'STATUS', 'ASSIGNEE'] as const).map(
              (g) => (
                <option key={g} value={g}>
                  Por {GROUPBY_LABELS[g]}
                </option>
              ),
            )}
          </select>

          <span className="text-[11px] text-muted-foreground">
            {totalTasksInRange} item{totalTasksInRange === 1 ? '' : 's'} visible
            {totalTasksInRange === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Eje cabecera */}
      <div className="relative shrink-0 border-b border-border bg-subtle">
        {/* Major ticks (cabecera ancha) */}
        <div className="relative h-6">
          {win.majorTicks.map((t) => (
            <div
              key={t.date.toISOString()}
              className="absolute top-0 flex h-full items-center border-l border-border/60 px-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground"
              style={{ left: `${t.positionPct}%` }}
            >
              {t.label}
            </div>
          ))}
        </div>
        {/* Minor ticks (cabecera fina) */}
        <div className="relative h-5">
          {win.minorTicks.map((t, i) => (
            <div
              key={`${t.date.toISOString()}-${i}`}
              className="absolute top-0 flex h-full items-center border-l border-border/40 px-1 text-[9px] text-muted-foreground"
              style={{ left: `${t.positionPct}%` }}
            >
              {zoom === 'WEEKS'
                ? `${t.date.getUTCDate()}/${t.date.getUTCMonth() + 1}`
                : zoom === 'MONTHS'
                  ? t.date.toLocaleDateString('es-MX', {
                      month: 'short',
                      timeZone: 'UTC',
                    })
                  : `Q${Math.floor(t.date.getUTCMonth() / 3) + 1}`}
            </div>
          ))}
        </div>
      </div>

      {/* Canvas con scroll vertical (y horizontal en mobile, donde el
          timeline necesita un mínimo ~720px para ser legible). */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[720px] md:min-w-0">
        {groups.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <h2 className="text-base font-semibold text-foreground">
              Sin tareas con fechas
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Para ver tareas en el Timeline necesitan tener startDate y endDate
              definidos.
            </p>
          </div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.key)
            // Tasks del grupo que caen dentro de la ventana visible.
            const tasksInRange = group.tasks.filter(
              (t) =>
                t.startDate &&
                t.endDate &&
                taskBarGeometry(new Date(t.startDate), new Date(t.endDate), win),
            )

            return (
              <section
                key={group.key}
                className="border-b border-border/50"
                aria-label={`Grupo ${group.label}`}
              >
                {/* Header de grupo */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="sticky top-0 z-10 flex w-full items-center gap-2 bg-secondary/40 px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-secondary/60"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  {groupBy === 'EPIC' && group.color ? (
                    <Sparkles
                      className="h-3.5 w-3.5"
                      style={{ color: group.color }}
                    />
                  ) : groupBy === 'PROJECT' ? (
                    <Layers className="h-3.5 w-3.5 text-indigo-400" />
                  ) : groupBy === 'ASSIGNEE' ? (
                    <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : null}
                  <span>{group.label}</span>
                  <span className="ml-2 rounded bg-input/60 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                    {tasksInRange.length}/{group.tasks.length}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="relative">
                    {/* Línea hoy */}
                    {todayPct != null && (
                      <div
                        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-400/70"
                        style={{ left: `${todayPct}%` }}
                        aria-hidden
                      />
                    )}
                    {tasksInRange.length === 0 ? (
                      <p className="px-4 py-3 text-[11px] italic text-muted-foreground">
                        Sin tareas en el rango visible.
                      </p>
                    ) : (
                      tasksInRange.map((t) => (
                        <TimelineRow
                          key={t.id}
                          task={t}
                          win={win}
                          onOpen={() => openDrawer(t.id)}
                        />
                      ))
                    )}
                  </div>
                )}
              </section>
            )
          })
        )}
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-card px-6 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Diamond className="h-3 w-3 text-amber-400" /> Hito
        </span>
        <span className="inline-flex items-center gap-1">
          <Flag className="h-3 w-3 text-rose-400" /> Crítica
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded bg-emerald-500" /> Done
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded bg-indigo-500" /> In progress
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-4 rounded bg-slate-500" /> To do
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="h-3 w-px bg-rose-400" /> Hoy
        </span>
      </div>
    </div>
  )
}

function TimelineRow({
  task,
  win,
  onOpen,
}: {
  task: TimelineTask
  win: ReturnType<typeof buildTimelineWindow>
  onOpen: () => void
}) {
  const geom = taskBarGeometry(
    new Date(task.startDate!),
    new Date(task.endDate!),
    win,
  )
  if (!geom) return null

  const statusBg = STATUS_TONE[task.status] ?? 'bg-slate-500'
  const priorityBorder = PRIORITY_BORDER[task.priority] ?? 'border-slate-500'

  return (
    <div className="relative h-9 border-b border-border/30 hover:bg-secondary/20">
      {/* Bar */}
      {task.isMilestone ? (
        <button
          type="button"
          onClick={onOpen}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
          style={{ left: `${geom.leftPct}%` }}
          title={`${task.title}${task.startDate ? ` · ${new Date(task.startDate).toLocaleDateString()}` : ''}`}
        >
          <Diamond className="h-4 w-4 fill-amber-400 text-amber-400" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Abrir ${task.title}`}
          className={clsx(
            'absolute top-1.5 flex h-6 cursor-pointer items-center gap-1.5 rounded-md border-l-2 px-1.5 text-[10px] font-medium text-white shadow-sm transition-all hover:opacity-90 hover:shadow-md',
            statusBg,
            priorityBorder,
          )}
          style={{
            left: `${geom.leftPct}%`,
            width: `${geom.widthPct}%`,
            minWidth: '12px',
          }}
          title={`${task.title} · ${task.priority} · ${task.startDate ? new Date(task.startDate).toLocaleDateString() : ''} → ${task.endDate ? new Date(task.endDate).toLocaleDateString() : ''}`}
        >
          {task.progress > 0 && task.progress < 100 && (
            <div
              className="absolute inset-y-0 left-0 rounded-l bg-black/25"
              style={{ width: `${task.progress}%` }}
              aria-hidden
            />
          )}
          <span className="relative truncate">
            {task.mnemonic && (
              <span className="opacity-80">{task.mnemonic} · </span>
            )}
            {task.title}
          </span>
        </button>
      )}
    </div>
  )
}
