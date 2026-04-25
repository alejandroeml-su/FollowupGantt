'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  MessageSquare,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { TaskStatus } from '@prisma/client'
import type { SerializedTask } from '@/lib/types'
import {
  moveTaskToColumn,
  reorderTask,
  bulkMoveTasksWithStatus,
} from '@/lib/actions/reorder'
import { TaskWithContextMenu } from './TaskContextMenuItems'
import { ColumnContextMenu } from './ColumnContextMenu'
import { TaskCreationModal } from './TaskCreationModal'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'
import type {
  PhaseOption,
  SprintOption,
} from './task-form/TaskMetaSidebar'
import { useUIStore } from '@/lib/stores/ui'
import { useTaskShortcuts } from '@/lib/hooks/useTaskShortcuts'
import { toast } from './Toaster'
import { TaskFiltersBar } from './TaskFiltersBar'
import { EMPTY_TASK_FILTERS, filterTasks, type TaskFilters } from '@/lib/taskFilters'

type Column = {
  id: string        // TaskStatus literal (TODO, IN_PROGRESS, …)
  title: string
  wipLimit: number | null
}

type ParentOption = Pick<SerializedTask, 'id' | 'title' | 'mnemonic'> & {
  project?: { id: string; name: string } | null
  projectId?: string
}

type Props = {
  columns: ReadonlyArray<{
    id: string
    title: string
    wipLimit: number | null
  }>
  tasksByColumn: Record<string, SerializedTask[]>
  projects: { id: string; name: string; areaId?: string | null }[]
  users: { id: string; name: string }[]
  gerencias?: { id: string; name: string }[]
  areas?: { id: string; name: string; gerenciaId?: string | null }[]
  allTasks?: ParentOption[]
  phases?: PhaseOption[]
  sprints?: SprintOption[]
}

const TYPE_COLOR: Record<string, string> = {
  AGILE_STORY: 'bg-indigo-500',
  PMI_TASK: 'bg-emerald-500',
  ITIL_TICKET: 'bg-rose-500',
}

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-500/15 text-red-300 border-red-500/40',
  HIGH: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  MEDIUM: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  LOW: 'bg-secondary text-muted-foreground border-border',
}

// Parser de errores tipados devueltos por las server actions
function parseActionError(err: unknown): { code: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
  return m ? { code: m[1], detail: m[2] } : { code: 'UNKNOWN', detail: msg }
}

export function KanbanBoardClient({
  columns,
  tasksByColumn,
  projects,
  users,
  gerencias = [],
  areas = [],
  allTasks = [],
  phases = [],
  sprints = [],
}: Props) {
  const [local, setLocal] = useState(tasksByColumn)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)

  const visibleByColumn = useMemo(() => {
    const out: Record<string, SerializedTask[]> = {}
    for (const [colId, list] of Object.entries(local)) {
      out[colId] = filterTasks(list, filters)
    }
    return out
  }, [local, filters])

  const selectedIds = useUIStore((s) => s.selectedIds)
  const toggleSelection = useUIStore((s) => s.toggleSelection)
  const clearSelection = useUIStore((s) => s.clearSelection)
  const columnPrefs = useUIStore((s) => s.columnPrefs)
  const drawerTaskId = useUIStore((s) => s.drawerTaskId)
  const openDrawer = useUIStore((s) => s.openDrawer)

  // Re-sync con el snapshot del server tras revalidatePath (patrón RSC).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(tasksByColumn)
  }, [tasksByColumn])

  const orderedIds = useMemo(() => {
    const out: string[] = []
    for (const c of columns) for (const t of local[c.id] ?? []) out.push(t.id)
    return out
  }, [columns, local])

  const [focusedId, setFocusedId] = useState<string | null>(orderedIds[0] ?? null)
  // Ajusta el foco si la tarea focused fue removida tras un revalidate.
  useEffect(() => {
    if (focusedId && !orderedIds.includes(focusedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedId(orderedIds[0] ?? null)
    }
  }, [orderedIds, focusedId])

  const drawerTask = useMemo(() => {
    if (!drawerTaskId) return null
    for (const list of Object.values(local)) {
      const t = list.find((x) => x.id === drawerTaskId)
      if (t) return t
    }
    return null
  }, [drawerTaskId, local])

  useTaskShortcuts({
    focusedTaskId: focusedId,
    orderedTaskIds: orderedIds,
    onFocus: setFocusedId,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const findColumnOf = useCallback(
    (taskId: string): string | null => {
      for (const [colId, list] of Object.entries(local)) {
        if (list.some((t) => t.id === taskId)) return colId
      }
      return null
    },
    [local],
  )

  const effectiveWip = (c: Column): number | null => {
    const override = columnPrefs[c.id]?.wipOverride
    if (override === null) return null // usuario deshabilitó WIP
    if (typeof override === 'number') return override
    return c.wipLimit
  }

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return

    const activeTaskId = String(active.id)
    const overId = String(over.id)
    const fromCol = findColumnOf(activeTaskId)
    const toCol = overId in local ? overId : findColumnOf(overId) ?? fromCol
    if (!fromCol || !toCol) return

    const toColumnDef = columns.find((c) => c.id === toCol)!
    const wipLimit = effectiveWip(toColumnDef)

    // ¿El drag es en lote? Sí si la tarea activa está en la selección y hay >1
    const isBulk = selectedIds.size > 1 && selectedIds.has(activeTaskId)
    const idsMoving = isBulk ? Array.from(selectedIds) : [activeTaskId]

    // Snapshot para posible rollback
    const snapshot = local

    // Optimistic: remover de sus columnas y colocar en toCol
    setLocal((prev) => {
      const next: Record<string, SerializedTask[]> = {}
      for (const [colId, list] of Object.entries(prev))
        next[colId] = list.filter((t) => !idsMoving.includes(t.id))

      const moving: SerializedTask[] = []
      for (const id of idsMoving) {
        const src = prev[findColumnOf(id) ?? fromCol].find((t) => t.id === id)
        if (src) moving.push({ ...src, status: toCol })
      }

      const dst = next[toCol] ?? []
      const overIdx =
        overId in prev ? dst.length : dst.findIndex((t) => t.id === overId)
      const insertAt = overIdx < 0 ? dst.length : overIdx
      dst.splice(insertAt, 0, ...moving)
      next[toCol] = dst
      return next
    })

    // Persistir
    try {
      if (isBulk && fromCol !== toCol) {
        await bulkMoveTasksWithStatus(idsMoving, toCol, null, wipLimit)
        toast.success(`${idsMoving.length} tareas movidas a ${toColumnDef.title}`)
        clearSelection()
      } else if (fromCol !== toCol) {
        await moveTaskToColumn(activeTaskId, null, null, null, {
          wipLimit: wipLimit,
          enforceStatus: toCol,
        })
        // Actualizar también status (la UI ya lo hizo optimista)
        // nota: si wipLimit se cumple, hacemos un update adicional del status
        // mediante moveTaskToColumn+status en la misma llamada. Para reducir
        // complejidad del endpoint aprovechamos la API existente `bulkMove…`
        // con un único id:
        await bulkMoveTasksWithStatus([activeTaskId], toCol, null, wipLimit)
      }

      // Reorder dentro del destino (before/after a partir del estado local)
      setLocal((prev) => {
        const list = prev[toCol]
        const idx = list.findIndex((t) => t.id === activeTaskId)
        const beforeId = idx > 0 ? list[idx - 1].id : null
        const afterId = idx < list.length - 1 ? list[idx + 1].id : null
        void reorderTask(activeTaskId, beforeId, afterId)
        return prev
      })
    } catch (err) {
      const { code, detail } = parseActionError(err)
      if (code === 'WIP_LIMIT_EXCEEDED') {
        toast.error(`WIP excedido · ${detail}`)
      } else {
        toast.error(`No se pudo mover: ${detail}`)
      }
      setLocal(snapshot) // rollback
    }
  }

  return (
    <>
      <TaskFiltersBar
        value={filters}
        onChange={setFilters}
        gerencias={gerencias}
        areas={areas}
        projects={projects}
        users={users}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full items-start gap-6 overflow-x-auto overflow-y-hidden p-8">
          {columns.map((col) => {
            const prefs = columnPrefs[col.id] ?? {}
            return (
              <BoardColumn
                key={col.id}
                column={col}
                tasks={visibleByColumn[col.id] ?? []}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelection}
                onOpenDrawer={openDrawer}
                columns={columns}
                collapsed={!!prefs.collapsed}
                accent={prefs.accent}
                effectiveWip={effectiveWip(col)}
                focusedId={focusedId}
                projects={projects}
                users={users}
                allTasks={allTasks}
                phases={phases}
                sprints={sprints}
              />
            )
          })}
        </div>

        <DragOverlay>
          {activeId ? (
            <DragOverlayCard
              byCol={local}
              activeId={activeId}
              selectedIds={selectedIds}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDrawer
        breadcrumbs={
          drawerTask ? (
            <>
              {drawerTask.project?.name}
              {' › '}
              <span className="text-foreground/90">
                #{drawerTask.id.substring(0, 6)}
              </span>
            </>
          ) : null
        }
        onNext={() => {
          if (!drawerTaskId) return
          const i = orderedIds.indexOf(drawerTaskId)
          const next = orderedIds[i + 1]
          if (next) useUIStore.getState().openDrawer(next)
        }}
        onPrev={() => {
          if (!drawerTaskId) return
          const i = orderedIds.indexOf(drawerTaskId)
          const prev = orderedIds[i - 1]
          if (prev) useUIStore.getState().openDrawer(prev)
        }}
      >
        {drawerTask ? (
          <TaskDrawerContent
            task={drawerTask}
            projects={projects}
            users={users}
            allTasks={allTasks.length > 0 ? (allTasks as SerializedTask[]) : Object.values(local).flat()}
          />
        ) : null}
      </TaskDrawer>
    </>
  )
}

function DragOverlayCard({
  byCol,
  activeId,
  selectedIds,
}: {
  byCol: Record<string, SerializedTask[]>
  activeId: string
  selectedIds: Set<string>
}) {
  const isBulk = selectedIds.size > 1 && selectedIds.has(activeId)
  const task = Object.values(byCol)
    .flat()
    .find((t) => t.id === activeId)

  return (
    <div className="relative rounded-lg border border-indigo-500/50 bg-secondary p-4 shadow-xl">
      <p className="truncate text-sm font-medium text-foreground">
        {task?.title ?? activeId}
      </p>
      {isBulk && (
        <span className="absolute -right-2 -top-2 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-indigo-500 px-1.5 text-xs font-semibold text-white shadow">
          +{selectedIds.size - 1}
        </span>
      )}
    </div>
  )
}

function BoardColumn({
  column,
  tasks,
  selectedIds,
  onToggleSelect,
  onOpenDrawer,
  columns,
  collapsed,
  accent,
  effectiveWip,
  focusedId,
  projects,
  users,
  allTasks,
  phases,
  sprints,
}: {
  column: Column
  tasks: SerializedTask[]
  selectedIds: Set<string>
  onToggleSelect: (id: string, additive?: boolean) => void
  onOpenDrawer: (id: string) => void
  columns: readonly Column[]
  collapsed: boolean
  accent?: string
  effectiveWip: number | null
  focusedId: string | null
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks: ParentOption[]
  phases: PhaseOption[]
  sprints: SprintOption[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const [createOpen, setCreateOpen] = useState(false)
  const isOverWip = effectiveWip != null && tasks.length > effectiveWip
  const nearWip =
    effectiveWip != null &&
    !isOverWip &&
    tasks.length >= Math.max(1, effectiveWip - 1)

  return (
    <div
      ref={setNodeRef}
      style={accent ? ({ ['--col-accent' as string]: accent }) : undefined}
      className={clsx(
        'flex h-full shrink-0 flex-col rounded-xl border bg-subtle/80 transition-[width]',
        collapsed ? 'w-12 items-center' : 'w-80',
        isOver
          ? 'border-indigo-500 ring-2 ring-indigo-500/40'
          : 'border-border',
      )}
      aria-label={`Columna ${column.title}`}
      role="group"
    >
      <ColumnContextMenu
        columnId={column.id}
        columnName={column.title}
        trigger={
          <div
            className={clsx(
              'flex w-full items-center justify-between border-b border-border/50 p-4',
              isOverWip && 'rounded-t-xl bg-red-500/5',
              collapsed && 'flex-col gap-2 p-3',
            )}
          >
            {accent && !collapsed && (
              <span
                aria-hidden
                className="absolute left-0 right-0 top-0 h-0.5 rounded-t-xl"
                style={{ background: accent }}
              />
            )}
            <div
              className={clsx(
                'flex items-center gap-2',
                collapsed && 'flex-col',
              )}
            >
              {!collapsed && (
                <h3
                  className="font-semibold text-foreground"
                  style={accent ? { color: accent } : undefined}
                >
                  {column.title}
                </h3>
              )}
              <span
                className={clsx(
                  'inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium',
                  isOverWip
                    ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30'
                    : nearWip
                      ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30'
                      : 'bg-secondary text-muted-foreground',
                )}
                aria-live="polite"
              >
                {tasks.length}
                {effectiveWip != null ? ` / ${effectiveWip}` : ''}
              </span>
              {collapsed && (
                <span className="rotate-180 text-[10px] uppercase tracking-widest text-muted-foreground [writing-mode:vertical-rl]">
                  {column.title}
                </span>
              )}
            </div>
            {!collapsed && (
              <button
                type="button"
                aria-label={`Opciones de ${column.title}`}
                className="text-muted-foreground hover:text-foreground/90"
                onClick={(e) => {
                  // abrir menú contextual con clic izquierdo en los "..."
                  e.preventDefault()
                  ;(e.currentTarget.parentElement as HTMLElement)?.dispatchEvent(
                    new MouseEvent('contextmenu', {
                      bubbles: true,
                      clientX: e.clientX,
                      clientY: e.clientY,
                    }),
                  )
                }}
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            )}
          </div>
        }
      />

      {!collapsed && (
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {tasks.map((task) => (
              <SortableKanbanCard
                key={task.id}
                task={task}
                selected={selectedIds.has(task.id)}
                focused={focusedId === task.id}
                onToggleSelect={onToggleSelect}
                onOpenDrawer={onOpenDrawer}
                columns={columns}
              />
            ))}
            {tasks.length === 0 && (
              <div className="rounded-lg border-2 border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Soltar aquí
              </div>
            )}
          </div>
        </SortableContext>
      )}

      {!collapsed && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label={`Añadir tarea en ${column.title}`}
            className="flex w-full items-center justify-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground/90"
          >
            <Plus className="h-3 w-3" /> Añadir tarea
          </button>
        </div>
      )}

      <TaskCreationModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projects={projects}
        users={users}
        allTasks={allTasks}
        phases={phases}
        sprints={sprints}
        defaultStatus={column.id as TaskStatus}
      />
    </div>
  )
}

function SortableKanbanCard({
  task,
  selected,
  focused,
  onToggleSelect,
  onOpenDrawer,
  columns,
}: {
  task: SerializedTask
  selected: boolean
  focused: boolean
  onToggleSelect: (id: string, additive?: boolean) => void
  onOpenDrawer: (id: string) => void
  columns: readonly Column[]
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const commentCount = task.comments?.length ?? 0

  return (
    <TaskWithContextMenu
      ctx={{
        taskId: task.id,
        columns: columns.map((c) => ({ id: c.id, name: c.title })),
      }}
    >
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            onToggleSelect(task.id, true)
            return
          }
          onOpenDrawer(task.id)
        }}
        className={clsx(
          'group relative flex flex-col gap-3 rounded-lg border bg-secondary p-4 shadow-sm transition-all',
          'hover:border-indigo-500/50 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
          focused
            ? 'border-indigo-500 ring-2 ring-indigo-500/60'
            : selected
              ? 'border-indigo-500 ring-2 ring-indigo-500/40'
              : 'border-border/50',
        )}
      >
        <div
          className={clsx(
            'absolute left-0 top-0 bottom-0 w-1 rounded-l-lg opacity-70',
            TYPE_COLOR[task.type] ?? 'bg-slate-500',
          )}
        />
        <div className="flex items-start justify-between pl-2">
          <p className="text-sm font-medium leading-snug text-foreground">
            {task.title}
          </p>
          <button
            type="button"
            {...(listeners as Record<string, unknown>)}
            aria-label="Arrastrar"
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between pl-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" title={task.id}>
              #{task.id.substring(0, 6)}
            </span>
            {commentCount > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <MessageSquare className="h-3 w-3" /> {commentCount}
              </span>
            )}
          </div>
          <span
            className={clsx(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              PRIORITY_COLOR[task.priority] ??
                'bg-slate-500/10 text-muted-foreground border-slate-500/20',
            )}
          >
            {task.priority}
          </span>
        </div>
      </div>
    </TaskWithContextMenu>
  )
}
