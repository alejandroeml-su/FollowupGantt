'use client'

/**
 * Wave P9 R2 (HU-9.7) — Sprint Planning UI con cap visible.
 *
 * Layout 2 columnas:
 *   Izquierda: Backlog (Tasks sin sprint del proyecto, ordenadas por
 *              priority + position).
 *   Derecha:   Sprint actual (Tasks ya asignadas a este sprint).
 *
 * Drag-drop entre columnas:
 *   - Arrastra del backlog al sprint → asigna sprintId.
 *   - Arrastra del sprint al backlog → quita sprintId (vuelve al backlog).
 *
 * Capacity widget (sticky top-right):
 *   - Suma de Story Points del sprint actual / Sprint.capacity.
 *   - Bar color-coded: verde (≤80%), amber (80-100%), rojo (>100%).
 *   - Hint de velocity histórica (últimos 3 sprints terminados).
 *
 * Reusa `bulkAssignToSprint` (#120) para mover tasks entre columnas.
 * Update optimista con rollback ante error.
 */

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  GripVertical,
  Sparkles,
  TrendingUp,
  Calendar,
  AlertTriangle,
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { clsx } from 'clsx'
import { bulkAssignToSprint, type BacklogTask } from '@/lib/actions/backlog'
import { EpicBadge } from '@/components/epics/EpicBadge'
import { toast } from '@/components/interactions/Toaster'

type SprintTask = {
  id: string
  mnemonic: string | null
  title: string
  status: string
  priority: string
  storyPoints: number | null
  position: number
  assignee: { id: string; name: string } | null
  epic: { id: string; name: string; color: string } | null
}

type Props = {
  project: { id: string; name: string }
  sprint: {
    id: string
    name: string
    goal: string | null
    startDate: string
    endDate: string
    capacity: number | null
    velocityActual: number | null
    startedAt: string | null
    endedAt: string | null
  }
  initialBacklog: BacklogTask[]
  initialSprintTasks: SprintTask[]
  recentSprints: {
    id: string
    name: string
    velocityActual: number
    capacity: number | null
  }[]
  epics: { id: string; name: string; color: string }[]
}

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-500/15 text-red-300 border-red-500/40',
  HIGH: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  MEDIUM: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  LOW: 'bg-secondary text-muted-foreground border-border',
}

const BACKLOG_DROP_ID = '__backlog__'
const SPRINT_DROP_ID = '__sprint__'

export default function SprintPlanningClient({
  project,
  sprint,
  initialBacklog,
  initialSprintTasks,
  recentSprints,
}: Props) {
  const [backlog, setBacklog] = useState(initialBacklog)
  const [sprintTasks, setSprintTasks] = useState(initialSprintTasks)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  // ── Métricas de capacity ─────────────────────────────────────────
  const sprintSP = useMemo(
    () => sprintTasks.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0),
    [sprintTasks],
  )
  const capacity = sprint.capacity ?? 0
  const utilizationPct = capacity > 0 ? Math.round((sprintSP / capacity) * 100) : 0
  const overCapacity = capacity > 0 && sprintSP > capacity

  const avgVelocity = useMemo(() => {
    if (recentSprints.length === 0) return null
    const sum = recentSprints.reduce((a, s) => a + s.velocityActual, 0)
    return Math.round(sum / recentSprints.length)
  }, [recentSprints])

  // ── Drag-drop handlers ───────────────────────────────────────────
  const findContainer = (id: string): 'backlog' | 'sprint' | null => {
    if (id === BACKLOG_DROP_ID) return 'backlog'
    if (id === SPRINT_DROP_ID) return 'sprint'
    if (backlog.find((t) => t.id === id)) return 'backlog'
    if (sprintTasks.find((t) => t.id === id)) return 'sprint'
    return null
  }

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
  }

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    const fromContainer = findContainer(activeId)
    const toContainer = findContainer(overId)

    if (!fromContainer || !toContainer) return
    if (fromContainer === toContainer) return // intra-columna ignorado en MVP

    // Cross-column move: backlog ↔ sprint.
    const movingTask =
      fromContainer === 'backlog'
        ? backlog.find((t) => t.id === activeId)
        : sprintTasks.find((t) => t.id === activeId)
    if (!movingTask) return

    const targetSprintId = toContainer === 'sprint' ? sprint.id : null

    // Optimistic update.
    if (fromContainer === 'backlog') {
      setBacklog((b) => b.filter((t) => t.id !== activeId))
      setSprintTasks((s) => [
        ...s,
        {
          id: movingTask.id,
          mnemonic: movingTask.mnemonic,
          title: movingTask.title,
          status: movingTask.status,
          priority: movingTask.priority,
          storyPoints: movingTask.storyPoints,
          position: 0,
          assignee: movingTask.assignee,
          epic: movingTask.epic,
        },
      ])
    } else {
      setSprintTasks((s) => s.filter((t) => t.id !== activeId))
      setBacklog((b) => [
        ...b,
        {
          id: movingTask.id,
          mnemonic: movingTask.mnemonic,
          title: movingTask.title,
          description: null,
          status: movingTask.status,
          priority: movingTask.priority,
          type: 'AGILE_STORY',
          storyPoints: movingTask.storyPoints,
          position: 0,
          assignee: movingTask.assignee,
          epic: movingTask.epic,
        },
      ])
    }

    // Persist.
    startTransition(async () => {
      try {
        await bulkAssignToSprint({
          taskIds: [activeId],
          sprintId: targetSprintId,
        })
      } catch (err) {
        // Rollback.
        setBacklog(initialBacklog)
        setSprintTasks(initialSprintTasks)
        toast.error(err instanceof Error ? err.message : 'Error al mover')
      }
    })
  }

  return (
    <>
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href={`/projects/${project.id}/backlog`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> {project.name} · Backlog
          </Link>
          <h1 className="mt-1 text-xl font-bold text-foreground">
            Sprint Planning · {sprint.name}
          </h1>
          {sprint.goal && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              🎯 {sprint.goal}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground inline-flex items-center gap-2">
            <Calendar className="h-3 w-3" />
            {new Date(sprint.startDate).toLocaleDateString()} →{' '}
            {new Date(sprint.endDate).toLocaleDateString()}
          </p>
        </div>

        {/* Widget capacity */}
        <CapacityWidget
          sprintSP={sprintSP}
          capacity={capacity}
          utilizationPct={utilizationPct}
          overCapacity={overCapacity}
          avgVelocity={avgVelocity}
          recentSprints={recentSprints}
        />
      </header>

      <div className="flex-1 overflow-hidden p-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid h-full grid-cols-2 gap-4">
            {/* Columna izquierda: Backlog */}
            <PlanningColumn
              dropId={BACKLOG_DROP_ID}
              title="Backlog del proyecto"
              subtitle={`${backlog.length} tarea${backlog.length === 1 ? '' : 's'} sin sprint`}
              tone="muted"
              tasks={backlog.map((t) => ({
                id: t.id,
                mnemonic: t.mnemonic,
                title: t.title,
                priority: t.priority,
                storyPoints: t.storyPoints,
                assignee: t.assignee,
                epic: t.epic,
              }))}
              empty="Backlog vacío. Crea Stories sin sprint y aparecerán aquí."
              isPending={isPending}
            />

            {/* Columna derecha: Sprint */}
            <PlanningColumn
              dropId={SPRINT_DROP_ID}
              title="Sprint actual"
              subtitle={`${sprintTasks.length} tarea${sprintTasks.length === 1 ? '' : 's'} comprometidas`}
              tone={overCapacity ? 'danger' : 'primary'}
              tasks={sprintTasks.map((t) => ({
                id: t.id,
                mnemonic: t.mnemonic,
                title: t.title,
                priority: t.priority,
                storyPoints: t.storyPoints,
                assignee: t.assignee,
                epic: t.epic,
              }))}
              empty="Arrastra tareas del backlog para comprometerlas a este sprint."
              isPending={isPending}
            />
          </div>

          <DragOverlay>
            {activeId ? (
              <div className="rounded-lg border border-indigo-500 bg-card px-3 py-2 shadow-2xl">
                <span className="text-sm font-medium text-foreground">
                  {[...backlog, ...sprintTasks].find((t) => t.id === activeId)?.title}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </>
  )
}

// ── Capacity widget sticky ─────────────────────────────────────────
function CapacityWidget({
  sprintSP,
  capacity,
  utilizationPct,
  overCapacity,
  avgVelocity,
  recentSprints,
}: {
  sprintSP: number
  capacity: number
  utilizationPct: number
  overCapacity: boolean
  avgVelocity: number | null
  recentSprints: { id: string; name: string; velocityActual: number }[]
}) {
  const barColor = overCapacity
    ? 'bg-rose-500'
    : utilizationPct >= 80
      ? 'bg-amber-500'
      : 'bg-emerald-500'

  return (
    <div className="rounded-lg border border-border bg-subtle px-4 py-2.5 min-w-[280px]">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Capacidad
        </span>
        <span
          className={clsx(
            'text-sm font-bold tabular-nums',
            overCapacity ? 'text-rose-400' : 'text-foreground',
          )}
        >
          {sprintSP}
          <span className="text-muted-foreground"> / {capacity || '?'} SP</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={clsx('h-full transition-all', barColor)}
          style={{ width: `${Math.min(utilizationPct, 100)}%` }}
        />
      </div>
      {overCapacity && (
        <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-rose-400">
          <AlertTriangle className="h-3 w-3" />
          Sobre-comprometido ({utilizationPct}%)
        </p>
      )}
      {avgVelocity !== null && (
        <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          Velocidad histórica: {avgVelocity} SP / sprint
          {recentSprints.length > 0 && ` (últimos ${recentSprints.length})`}
        </p>
      )}
    </div>
  )
}

// ── Columna ────────────────────────────────────────────────────────
type ColumnTask = {
  id: string
  mnemonic: string | null
  title: string
  priority: string
  storyPoints: number | null
  assignee: { id: string; name: string } | null
  epic: { id: string; name: string; color: string } | null
}

function PlanningColumn({
  dropId,
  title,
  subtitle,
  tone,
  tasks,
  empty,
  isPending,
}: {
  dropId: string
  title: string
  subtitle: string
  tone: 'muted' | 'primary' | 'danger'
  tasks: ColumnTask[]
  empty: string
  isPending: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId })

  const totalSP = tasks.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0)

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        'flex h-full flex-col rounded-xl border bg-card transition-colors',
        tone === 'danger' && 'border-rose-500/40',
        tone === 'primary' && 'border-indigo-500/40',
        tone === 'muted' && 'border-border',
        isOver && 'ring-2 ring-indigo-500/60',
      )}
    >
      <header className="shrink-0 border-b border-border px-4 py-2.5">
        <div className="flex items-baseline justify-between">
          <h2
            className={clsx(
              'text-sm font-semibold uppercase tracking-wider',
              tone === 'danger' && 'text-rose-300',
              tone === 'primary' && 'text-indigo-300',
              tone === 'muted' && 'text-muted-foreground',
            )}
          >
            {title}
          </h2>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {totalSP} SP
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11px] italic text-muted-foreground">
            {empty}
          </div>
        ) : (
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-1.5">
              {tasks.map((t) => (
                <PlanningTaskRow key={t.id} task={t} disabled={isPending} />
              ))}
            </ul>
          </SortableContext>
        )}
      </div>
    </div>
  )
}

function PlanningTaskRow({
  task,
  disabled,
}: {
  task: ColumnTask
  disabled: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={clsx(
        'group flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 shadow-sm hover:border-indigo-500/40',
        disabled && 'opacity-60',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...(listeners as Record<string, unknown>)}
        aria-label="Arrastrar para mover"
        className="cursor-grab text-muted-foreground active:cursor-grabbing hover:text-foreground"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {task.mnemonic && (
            <span className="rounded bg-secondary px-1 py-0.5 text-[9px] font-mono text-muted-foreground border border-border/40">
              {task.mnemonic}
            </span>
          )}
          <span className="truncate text-xs font-medium text-foreground">
            {task.title}
          </span>
        </div>
        {(task.epic || task.assignee) && (
          <div className="mt-0.5 flex items-center gap-1.5">
            {task.epic && (
              <EpicBadge
                name={task.epic.name}
                color={task.epic.color}
                size="xs"
              />
            )}
            {task.assignee && (
              <span className="text-[10px] text-muted-foreground">
                {task.assignee.name}
              </span>
            )}
          </div>
        )}
      </div>

      <span
        className={clsx(
          'shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase',
          PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.LOW,
        )}
      >
        {task.priority}
      </span>

      {task.storyPoints !== null && task.storyPoints !== undefined && (
        <span
          className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-foreground border border-border/40"
          title={`${task.storyPoints} Story Points`}
        >
          {task.storyPoints}
        </span>
      )}

      {/* Sparkles para indicar que la task viene de Epic — solo decorativo,
          el badge ya está arriba. Aquí lo evitamos para no saturar. */}
      <Sparkles className="hidden h-3 w-3 text-muted-foreground" aria-hidden />
    </li>
  )
}
