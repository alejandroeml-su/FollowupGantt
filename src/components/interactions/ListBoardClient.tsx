'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Flag,
  GripVertical,
  MessageSquare,
  UserCircle2,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { SerializedTask } from '@/lib/types'
import { reorderTask } from '@/lib/actions/reorder'
import { deleteTask } from '@/lib/actions'
import { useUIStore } from '@/lib/stores/ui'
import { BulkActionsToolbar } from './BulkActionsToolbar'
import { computeProgressWithSource } from '@/lib/progress/rollup'
import { useTaskShortcuts } from '@/lib/hooks/useTaskShortcuts'
import StatusSelector from '@/components/StatusSelector'
import { TaskWithContextMenu } from './TaskContextMenuItems'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'
import { TaskFiltersBar } from './TaskFiltersBar'
import { EMPTY_TASK_FILTERS, filterTasksWithSubtasks, type TaskFilters } from '@/lib/taskFilters'
import { SavedViewsDropdown, type SavedViewSummary } from '@/components/views/SavedViewsDropdown'
import { GroupBySelector } from '@/components/views/GroupBySelector'
import { groupTasks, type GroupKey } from '@/lib/views/group-tasks'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { useTaskRealtimeRefresh } from '@/lib/realtime/use-task-realtime'

type Props = {
  tasks: (SerializedTask & { subtasks?: SerializedTask[] })[]
  projects: { id: string; name: string; areaId?: string | null }[]
  users: { id: string; name: string }[]
  gerencias?: { id: string; name: string }[]
  areas?: { id: string; name: string; gerenciaId?: string | null }[]
  /** Ola P2 · Equipo P2-1 — vistas guardadas disponibles para LIST. */
  savedViews?: SavedViewSummary[]
  /**
   * Wave P7 · C-DEBT-2 — Identidad del usuario actual para el drawer
   * (presence + edit locks). Forwardeada a `<TaskDrawerContent>`.
   * Default `null` = back-compat para callers sin sesión.
   */
  currentUser?: CurrentUserPresence | null
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  DONE: <CheckCircle2 className="h-4 w-4" />,
  IN_PROGRESS: <Clock className="h-4 w-4" />,
}

const STATUS_COLOR: Record<string, string> = {
  TODO: 'text-muted-foreground',
  IN_PROGRESS: 'text-indigo-400',
  DONE: 'text-emerald-400',
  REVIEW: 'text-amber-400',
}

const PRIORITY_COLOR: Record<string, string> = {
  LOW: 'text-muted-foreground',
  MEDIUM: 'text-blue-300',
  HIGH: 'text-amber-300',
  CRITICAL: 'text-red-300',
}

export function ListBoardClient({
  tasks,
  projects,
  users,
  gerencias = [],
  areas = [],
  savedViews = [],
  currentUser = null,
}: Props) {
  // Refresca la vista cuando cualquier tarea cambia en la BD (postgres CDC
  // vía Supabase Realtime). Hace que los rollups y el progress se
  // actualicen sin refresh manual cuando otro tab/usuario muta una tarea.
  useTaskRealtimeRefresh()

  const [items, setItems] = useState(tasks)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(tasks[0]?.id ?? null)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tasks.filter((t) => t.subtasks?.length).map((t) => t.id)),
  )
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)
  // Ola P2 — agrupación dinámica. `null` = sin agrupar.
  const [groupBy, setGroupBy] = useState<GroupKey | null>(null)
  const visibleItems = useMemo(() => filterTasksWithSubtasks(items, filters), [items, filters])
  const groups = useMemo(
    () => groupTasks(visibleItems, groupBy, { users }),
    [visibleItems, groupBy, users],
  )
  const showGroups = groupBy !== null

  const selectedIds = useUIStore((s) => s.selectedIds)
  const toggleSelection = useUIStore((s) => s.toggleSelection)
  const selectRange = useUIStore((s) => s.selectRange)
  const clearSelection = useUIStore((s) => s.clearSelection)
  const drawerTaskId = useUIStore((s) => s.drawerTaskId)

  // Re-sync cuando el server revalida la página (revalidatePath en actions).
  // El setState-in-effect es intencional: el server es la fuente de verdad
  // y la lista optimista debe rendirse al snapshot canónico al regresar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(tasks)
  }, [tasks])

  // Lista plana ordenada (incluyendo subtareas visibles) para navegación J/K
  const orderedIds = useMemo(() => {
    const out: string[] = []
    for (const t of items) {
      out.push(t.id)
      if (expanded.has(t.id)) {
        for (const s of t.subtasks ?? []) out.push(s.id)
      }
    }
    return out
  }, [items, expanded])

  const drawerTask = useMemo(() => {
    if (!drawerTaskId) return null
    for (const t of items) {
      if (t.id === drawerTaskId) return t
      for (const s of t.subtasks ?? []) if (s.id === drawerTaskId) return s
    }
    return null
  }, [drawerTaskId, items])

  // Shortcuts (↑↓, Enter, Esc, T, /, E, S, A, D, ⌘D, ⌘L, ⌘⌫, J/K)
  useTaskShortcuts({
    focusedTaskId: focusedId,
    orderedTaskIds: orderedIds,
    onFocus: setFocusedId,
    onDelete: async (id) => {
      const ok = confirm('¿Eliminar esta tarea?')
      if (!ok) return
      const fd = new FormData()
      fd.set('id', id)
      await deleteTask(fd)
    },
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

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = items.findIndex((i) => i.id === active.id)
    const to = items.findIndex((i) => i.id === over.id)
    if (from < 0 || to < 0) return

    const next = arrayMove(items, from, to)
    setItems(next) // optimistic

    const beforeId = to > 0 ? next[to - 1].id : null
    const afterId = to < next.length - 1 ? next[to + 1].id : null

    try {
      await reorderTask(String(active.id), beforeId, afterId)
    } catch {
      setItems(items) // rollback
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
      <div
        data-testid="saved-views-toolbar"
        className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/10 px-6 py-2"
      >
        <SavedViewsDropdown
          surface="LIST"
          views={savedViews}
          currentFilters={filters as Record<string, unknown>}
          currentGrouping={groupBy}
          onApplyView={(v) => {
            if (!v) {
              setFilters(EMPTY_TASK_FILTERS)
              setGroupBy(null)
              return
            }
            setFilters((v.filters as TaskFilters) ?? EMPTY_TASK_FILTERS)
            setGroupBy((v.grouping as GroupKey | null) ?? null)
          }}
        />
        <GroupBySelector value={groupBy} onChange={setGroupBy} />
      </div>
      <div className="divide-y divide-border/50">
        {/* Bulk action toolbar (visible solo cuando hay selección) */}
        {selectedIds.size > 0 ? (
          <BulkActionsToolbar
            count={selectedIds.size}
            selectedIds={selectedIds}
            onClear={clearSelection}
            onSelectAllVisible={() =>
              selectRange(visibleItems.map((t) => t.id))
            }
            visibleCount={visibleItems.length}
          />
        ) : (
          <div className="flex items-center bg-secondary/20 px-4 py-1.5 text-[11px]">
            <span className="rounded border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 font-semibold text-indigo-400">
              {visibleItems.length} de {items.length} tareas
              {showGroups && ` · ${groups.length} grupos`}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              Shift + / atajos · / buscar · T nueva tarea
            </span>
          </div>
        )}

        {/* Column headers — sticky con grid alineado a las filas */}
        <div className="sticky top-0 z-10 grid grid-cols-12 items-center gap-4 border-b border-border bg-muted/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
          <div className="col-span-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={
                visibleItems.length > 0 &&
                visibleItems.every((t) => selectedIds.has(t.id))
              }
              onChange={(e) => {
                if (e.target.checked) {
                  selectRange(visibleItems.map((t) => t.id))
                } else {
                  clearSelection()
                }
              }}
              aria-label="Seleccionar todas las tareas visibles"
              className="h-4 w-4 cursor-pointer accent-indigo-500"
              data-testid="task-list-select-all"
            />
            <span>Tarea</span>
          </div>
          <div className="col-span-2">Asignado</div>
          <div className="col-span-2">Estado</div>
          <div className="col-span-2">Fecha límite</div>
          <div className="col-span-1 text-center">Prioridad</div>
          <div className="col-span-1 text-center">ID</div>
        </div>

        {visibleItems.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? 'No hay tareas. Crea la primera desde "Nueva Tarea".'
              : 'Ninguna tarea coincide con los filtros.'}
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleItems.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {showGroups
              ? groups.map((g) => (
                  <div key={g.key || '__none__'} data-testid={`task-group-${g.key || 'none'}`}>
                    <div className="flex items-center bg-secondary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>{g.label}</span>
                      <span className="ml-2 rounded bg-secondary/40 px-1.5 py-0.5 text-[10px] text-foreground">
                        {g.count}
                      </span>
                    </div>
                    {g.tasks.map((task) => (
                      <SortableListRow
                        key={task.id}
                        task={task}
                        level={0}
                        focused={focusedId === task.id}
                        selected={selectedIds.has(task.id)}
                        expanded={expanded.has(task.id)}
                        onFocus={() => setFocusedId(task.id)}
                        onToggleExpand={() =>
                          setExpanded((prev) => {
                            const n = new Set(prev)
                            if (n.has(task.id)) n.delete(task.id)
                            else n.add(task.id)
                            return n
                          })
                        }
                        onToggleSelect={(additive) =>
                          toggleSelection(task.id, additive)
                        }
                      />
                    ))}
                  </div>
                ))
              : visibleItems.map((task) => (
                  <SortableListRow
                    key={task.id}
                    task={task}
                    level={0}
                    focused={focusedId === task.id}
                    selected={selectedIds.has(task.id)}
                    expanded={expanded.has(task.id)}
                    onFocus={() => setFocusedId(task.id)}
                    onToggleExpand={() =>
                      setExpanded((prev) => {
                        const n = new Set(prev)
                        if (n.has(task.id)) n.delete(task.id)
                        else n.add(task.id)
                        return n
                      })
                    }
                    onToggleSelect={(additive) =>
                      toggleSelection(task.id, additive)
                    }
                  >
                    {expanded.has(task.id) &&
                      (task.subtasks ?? []).map((sub) => (
                        <StaticListRow
                          key={sub.id}
                          task={sub}
                          level={1}
                          focused={focusedId === sub.id}
                          selected={selectedIds.has(sub.id)}
                          onFocus={() => setFocusedId(sub.id)}
                          onToggleSelect={(additive) =>
                            toggleSelection(sub.id, additive)
                          }
                        />
                      ))}
                  </SortableListRow>
                ))}
          </SortableContext>

          <DragOverlay>
            {activeId ? (
              <div className="rounded-lg border border-indigo-500/50 bg-secondary px-4 py-2 shadow-xl">
                <p className="truncate text-sm text-foreground">
                  {items.find((t) => t.id === activeId)?.title}
                </p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

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
        currentUser={currentUser}
      >
        {drawerTask ? (
          <TaskDrawerContent
            task={drawerTask}
            projects={projects}
            users={users}
            allTasks={items}
            currentUser={currentUser}
          />
        ) : null}
      </TaskDrawer>
    </>
  )
}

// ───────────────────────── Rows ───────────────────────────────────

type RowProps = {
  task: SerializedTask
  level: number
  focused: boolean
  selected: boolean
  expanded?: boolean
  onFocus: () => void
  onToggleExpand?: () => void
  onToggleSelect: (additive: boolean) => void
  dragHandle?: React.ReactNode
  setNodeRef?: (node: HTMLElement | null) => void
  style?: React.CSSProperties
  children?: React.ReactNode
}

function Row({
  task,
  level,
  focused,
  selected,
  expanded,
  onFocus,
  onToggleExpand,
  onToggleSelect,
  dragHandle,
  setNodeRef,
  style,
  children,
}: RowProps) {
  const openDrawer = useUIStore((s) => s.openDrawer)
  const priorityColor = PRIORITY_COLOR[task.priority] ?? 'text-muted-foreground'
  const statusColor = STATUS_COLOR[task.status] ?? 'text-muted-foreground'
  const commentCount = task.comments?.length ?? 0
  const hasSubs = (task.subtasks?.length ?? 0) > 0
  const dateStr = task.endDate
    ? (() => {
        try {
          return new Date(task.endDate).toLocaleDateString()
        } catch {
          return 'Sin fecha'
        }
      })()
    : 'Sin fecha'

  // Avance rollup: si la task tiene subtareas, % derivado del promedio
  // de subtareas (recursivo). Si es hoja, su `progress` directo.
  const progressInfo = computeProgressWithSource(task)

  return (
    <>
      <TaskWithContextMenu ctx={{ taskId: task.id }}>
        <div
          ref={setNodeRef}
          style={style}
          data-task-id={task.id}
          data-focused={focused || undefined}
          tabIndex={-1}
          role="row"
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault()
              onToggleSelect(true)
            } else {
              onFocus()
              openDrawer(task.id)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              openDrawer(task.id)
            }
          }}
          className={clsx(
            'group grid cursor-pointer grid-cols-12 items-center gap-4 border-l-2 px-4 py-2.5 text-sm transition-all',
            focused
              ? 'border-indigo-500 bg-secondary/60 outline-2 outline-indigo-500'
              : selected
                ? 'border-indigo-500/50 bg-indigo-500/5'
                : 'border-transparent hover:border-indigo-500 hover:bg-secondary/50',
          )}
        >
          <div
            className="col-span-4 flex items-center"
            style={{ paddingLeft: `${level * 1.5}rem` }}
          >
            {/* Checkbox de multi-selección. Click directo NO abre el drawer
                (stopPropagation); para seleccionar varias usar también
                Ctrl/Cmd+Click sobre la fila. */}
            <input
              type="checkbox"
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation()
                onToggleSelect(true)
              }}
              aria-label={`Seleccionar tarea ${task.title}`}
              className="mr-2 h-4 w-4 cursor-pointer accent-indigo-500"
              data-testid={`task-row-checkbox-${task.id}`}
            />

            {dragHandle}

            {hasSubs ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand?.()
                }}
                aria-label={expanded ? 'Colapsar' : 'Expandir'}
                className="mr-1 rounded p-0.5 text-muted-foreground hover:bg-secondary/80 hover:text-foreground/90"
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : (
              <div className="mr-1 w-5" />
            )}

            <span className={clsx('mr-2 h-4 w-4', statusColor)}>
              {STATUS_ICON[task.status] ?? <Circle className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-foreground group-hover:text-indigo-300">
                  {task.title}
                </span>
                {commentCount > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                    <MessageSquare className="h-3 w-3" /> {commentCount}
                  </span>
                )}
              </div>
              {/* Barra de avance con rollup (promedio de subtareas si es padre). */}
              <div
                className="mt-1 flex items-center gap-2"
                title={
                  progressInfo.derived
                    ? `${progressInfo.percent}% (promedio de ${progressInfo.childCount} subtarea${progressInfo.childCount === 1 ? '' : 's'})`
                    : `${progressInfo.percent}%`
                }
                data-testid={`task-row-progress-${task.id}`}
              >
                <div
                  className="relative h-1 flex-1 overflow-hidden rounded-full bg-secondary/40"
                  role="progressbar"
                  aria-valuenow={progressInfo.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Avance: ${progressInfo.percent}%`}
                >
                  <div
                    className={clsx(
                      'absolute left-0 top-0 h-full rounded-full transition-all',
                      progressInfo.percent >= 100
                        ? 'bg-emerald-500'
                        : progressInfo.percent >= 50
                          ? 'bg-indigo-500'
                          : 'bg-amber-500',
                    )}
                    style={{ width: `${progressInfo.percent}%` }}
                  />
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {progressInfo.percent}%
                  {progressInfo.derived && (
                    <span className="ml-0.5 opacity-60" aria-hidden>
                      ↻
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="col-span-2 flex items-center">
            <UserCircle2 className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="truncate text-xs text-foreground/90">
              {task.assignee?.name ?? 'Sin Asignar'}
            </span>
          </div>

          <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
            <StatusSelector taskId={task.id} currentStatus={task.status} />
          </div>

          <div className="col-span-2 flex items-center text-xs text-muted-foreground">
            <Calendar className="mr-2 h-3.5 w-3.5" />
            {dateStr}
          </div>

          <div className="col-span-1 flex justify-center">
            <Flag className={clsx('h-4 w-4', priorityColor)} />
          </div>

          <div className="col-span-1 flex justify-center text-xs text-muted-foreground">
            #{task.id.substring(0, 4)}
          </div>
        </div>
      </TaskWithContextMenu>
      {children}
    </>
  )
}

function SortableListRow({
  children,
  ...props
}: Omit<RowProps, 'dragHandle' | 'setNodeRef' | 'style'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.task.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Row
      {...props}
      setNodeRef={setNodeRef}
      style={style}
      dragHandle={
        <button
          type="button"
          {...attributes}
          {...(listeners as Record<string, unknown>)}
          aria-label="Arrastrar para reordenar"
          onClick={(e) => e.stopPropagation()}
          className="mr-1 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      }
    >
      {children}
    </Row>
  )
}

function StaticListRow(props: Omit<RowProps, 'dragHandle'>) {
  // Subtareas: no se arrastran en Sprint 1 (se anidan con Shift+drag en Sprint 2)
  return <Row {...props} dragHandle={<div className="mr-1 w-5" />} />
}
