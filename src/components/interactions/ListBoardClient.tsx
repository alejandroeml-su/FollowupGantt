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
import { EpicBadge } from '@/components/epics/EpicBadge'
import { useTaskShortcuts } from '@/lib/hooks/useTaskShortcuts'
import StatusSelector from '@/components/StatusSelector'
import { AssigneeSelector } from './cell-editors/AssigneeSelector'
import { PrioritySelector } from './cell-editors/PrioritySelector'
import { DueDateSelector } from './cell-editors/DueDateSelector'
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
  /** Wave P9 — Epics activas para filtro. */
  epics?: { id: string; name: string; color: string; projectId: string }[]
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
  epics = [],
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
  const toggleManySelection = useUIStore((s) => s.toggleManySelection)
  const selectRange = useUIStore((s) => s.selectRange)
  const clearSelection = useUIStore((s) => s.clearSelection)
  const drawerTaskId = useUIStore((s) => s.drawerTaskId)

  /**
   * Wave P9 follow-up — cascade selection: al toggle una task con
   * subtasks, también se seleccionan/deseleccionan todos sus
   * descendientes recursivamente. Edwin: "si seleccionamos una tarea
   * que tiene varias tareas anidadas también estas tareas dependientes
   * deben de seleccionarse".
   */
  const collectIdsCascade = (root: SerializedTask): string[] => {
    const ids: string[] = []
    const visit = (t: SerializedTask) => {
      ids.push(t.id)
      for (const c of t.subtasks ?? []) visit(c)
    }
    visit(root)
    return ids
  }
  const findTaskInTree = (
    nodes: (SerializedTask & { subtasks?: SerializedTask[] })[],
    targetId: string,
  ): SerializedTask | null => {
    for (const n of nodes) {
      if (n.id === targetId) return n
      if (n.subtasks) {
        const found = findTaskInTree(n.subtasks, targetId)
        if (found) return found
      }
    }
    return null
  }
  const toggleSelectionCascade = (taskId: string, additive: boolean) => {
    const target = findTaskInTree(items, taskId)
    if (!target) {
      toggleSelection(taskId, additive)
      return
    }
    const ids = collectIdsCascade(target)
    if (ids.length <= 1) {
      toggleSelection(taskId, additive)
    } else {
      toggleManySelection(ids, additive)
    }
  }

  // Re-sync cuando el server revalida la página (revalidatePath en actions).
  // El setState-in-effect es intencional: el server es la fuente de verdad
  // y la lista optimista debe rendirse al snapshot canónico al regresar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(tasks)
  }, [tasks])

  // Lista plana ordenada (DFS, sólo nodos visibles según `expanded`).
  // Recursiva para soportar N niveles — antes sólo 2 niveles eran
  // navegables con J/K y los descendientes profundos quedaban
  // huérfanos del foco.
  const orderedIds = useMemo(() => {
    const out: string[] = []
    const visit = (t: SerializedTask) => {
      out.push(t.id)
      if (expanded.has(t.id)) {
        for (const s of t.subtasks ?? []) visit(s)
      }
    }
    for (const t of items) visit(t)
    return out
  }, [items, expanded])

  // Búsqueda recursiva de la tarea del drawer en TODA la jerarquía.
  // Antes la búsqueda paraba en nivel 1 (raíz + subtasks directas) y
  // un click en una subtarea de nivel 3+ dejaba el drawer vacío
  // aunque la fila se renderizaba correctamente.
  const drawerTask = useMemo(() => {
    if (!drawerTaskId) return null
    const find = (list: SerializedTask[] | undefined): SerializedTask | null => {
      if (!list) return null
      for (const t of list) {
        if (t.id === drawerTaskId) return t
        const inChild = find(t.subtasks)
        if (inChild) return inChild
      }
      return null
    }
    return find(items)
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
        epics={epics}
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
          <div className="flex items-center bg-secondary/20 px-3 py-1.5 text-[11px] md:px-4">
            <span className="rounded border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 font-semibold text-indigo-400">
              {visibleItems.length} de {items.length} tareas
              {showGroups && ` · ${groups.length} grupos`}
            </span>
            <span className="ml-auto hidden text-[10px] text-muted-foreground md:inline">
              Shift + / atajos · / buscar · T nueva tarea
            </span>
          </div>
        )}

        {/* Column headers — sticky con grid alineado a las filas.
            Wave P16-C · mobile-first: en <md ocultamos las columnas
            secundarias (asignado, fecha, prioridad, id) y dejamos solo
            "Tarea" + "Estado" para que el grid no se rompa en pantallas
            estrechas. El detalle completo se ve en el TaskDrawer. */}
        <div className="sticky top-0 z-10 grid grid-cols-6 items-center gap-2 border-b border-border bg-muted/70 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur md:grid-cols-12 md:gap-4 md:px-4">
          <div className="col-span-4 flex items-center gap-2 md:col-span-4">
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
          <div className="hidden md:col-span-2 md:block">Asignado</div>
          <div className="col-span-2 md:col-span-2">Estado</div>
          <div className="hidden md:col-span-2 md:block">Fecha límite</div>
          <div className="hidden md:col-span-1 md:block md:text-center">Prioridad</div>
          <div className="hidden md:col-span-1 md:block md:text-center">ID</div>
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
                    <div className="flex items-center bg-subtle px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-y border-border/40">
                      <span>{g.label}</span>
                      <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground">
                        {g.count}
                      </span>
                    </div>
                    {g.tasks.map((task) => (
                      <RootTaskTree
                        key={task.id}
                        task={task}
                        focusedId={focusedId}
                        selectedIds={selectedIds}
                        expanded={expanded}
                        setFocusedId={setFocusedId}
                        setExpanded={setExpanded}
                        toggleSelection={toggleSelectionCascade}
                        users={users}
                      />
                    ))}
                  </div>
                ))
              : visibleItems.map((task) => (
                  <RootTaskTree
                    key={task.id}
                    task={task}
                    focusedId={focusedId}
                    selectedIds={selectedIds}
                    expanded={expanded}
                    setFocusedId={setFocusedId}
                    setExpanded={setExpanded}
                    toggleSelection={toggleSelectionCascade}
                    users={users}
                  />
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
  /** Wave P9 follow-up — usuarios para AssigneeSelector inline. */
  users?: { id: string; name: string; email?: string | null }[]
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
  users = [],
}: RowProps) {
  const openDrawer = useUIStore((s) => s.openDrawer)
  const statusColor = STATUS_COLOR[task.status] ?? 'text-muted-foreground'
  const commentCount = task.comments?.length ?? 0
  const hasSubs = (task.subtasks?.length ?? 0) > 0

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
            // Wave P16-C · mobile-first: en <md usamos grid-cols-6 (Tarea
            // 4col + Estado 2col) y ocultamos asignado/fecha/prioridad/id.
            // En md+ recuperamos la grilla 12-col completa.
            'group grid cursor-pointer grid-cols-6 items-center gap-2 border-l-2 border-b border-b-border/40 px-3 py-3 text-sm transition-all md:grid-cols-12 md:gap-4 md:px-4 md:py-2.5',
            focused
              ? 'border-l-indigo-400 bg-secondary/80 outline-2 outline-indigo-400'
              : selected
                ? 'border-l-indigo-500/60 bg-indigo-500/10'
                : 'border-l-transparent hover:border-l-indigo-400 hover:bg-secondary/70',
          )}
        >
          <div
            className="col-span-4 flex items-center md:col-span-4"
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
                {/* Wave P9 — badge Epic (si está asignada) en mismo flow del título. */}
                {task.epic && (
                  <EpicBadge
                    name={task.epic.name}
                    color={task.epic.color}
                    size="xs"
                    className="shrink-0"
                  />
                )}
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
                  className="relative h-1 flex-1 overflow-hidden rounded-full bg-secondary"
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

          {/* Wave P9 follow-up — celdas editables inline.
              Wave P16-C · mobile: ocultamos columnas secundarias en <md
              para que la fila quepa sin scroll horizontal. La edición
              completa está disponible vía drawer (tap → drawer) que
              renderiza el selector vertical. */}
          <div
            className="hidden md:col-span-2 md:block"
            onClick={(e) => e.stopPropagation()}
          >
            <AssigneeSelector
              taskId={task.id}
              currentAssignee={task.assignee ?? null}
              users={users}
            />
          </div>

          <div
            className="col-span-2 md:col-span-2"
            onClick={(e) => e.stopPropagation()}
          >
            <StatusSelector taskId={task.id} currentStatus={task.status} />
          </div>

          <div
            className="hidden md:col-span-2 md:block"
            onClick={(e) => e.stopPropagation()}
          >
            <DueDateSelector
              taskId={task.id}
              currentEndDate={task.endDate ?? null}
            />
          </div>

          <div
            className="hidden md:col-span-1 md:flex md:justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <PrioritySelector
              taskId={task.id}
              currentPriority={task.priority}
            />
          </div>

          <div className="hidden md:col-span-1 md:flex md:justify-center text-xs text-muted-foreground">
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

type RecursiveTreeProps = {
  task: SerializedTask
  focusedId: string | null
  selectedIds: Set<string>
  expanded: Set<string>
  setFocusedId: (id: string) => void
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>
  toggleSelection: (id: string, additive: boolean) => void
}

/**
 * Renderiza una tarea raíz con SortableListRow (drag&drop activo) y, de
 * forma recursiva, todos sus descendientes con StaticListRow indentados
 * por `level`. Resuelve el bug 2026-05-06: antes el JSX sólo iteraba
 * un nivel y los nietos/bisnietos se perdían visualmente.
 */
function RootTaskTree({
  task,
  focusedId,
  selectedIds,
  expanded,
  setFocusedId,
  setExpanded,
  toggleSelection,
  users = [],
}: RecursiveTreeProps & { users?: { id: string; name: string; email?: string | null }[] }) {
  const isExpanded = expanded.has(task.id)
  const onToggleExpand = () =>
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(task.id)) n.delete(task.id)
      else n.add(task.id)
      return n
    })

  return (
    <SortableListRow
      task={task}
      level={0}
      focused={focusedId === task.id}
      selected={selectedIds.has(task.id)}
      expanded={isExpanded}
      onFocus={() => setFocusedId(task.id)}
      onToggleExpand={onToggleExpand}
      onToggleSelect={(additive) => toggleSelection(task.id, additive)}
      users={users}
    >
      {isExpanded &&
        (task.subtasks ?? []).map((child) => (
          <SubtaskBranch
            key={child.id}
            task={child}
            level={1}
            focusedId={focusedId}
            selectedIds={selectedIds}
            expanded={expanded}
            setFocusedId={setFocusedId}
            setExpanded={setExpanded}
            toggleSelection={toggleSelection}
            users={users}
          />
        ))}
    </SortableListRow>
  )
}

/**
 * Renderiza una subtarea (no raíz) con StaticListRow y recursa sobre
 * sus hijos cuando está expandida. La indentación visual la maneja
 * `Row` vía `level * 1.5rem` de padding-left.
 */
function SubtaskBranch({
  task,
  level,
  focusedId,
  selectedIds,
  expanded,
  setFocusedId,
  setExpanded,
  toggleSelection,
  users = [],
}: RecursiveTreeProps & { level: number; users?: { id: string; name: string; email?: string | null }[] }) {
  const hasChildren = (task.subtasks?.length ?? 0) > 0
  const isExpanded = expanded.has(task.id)
  const onToggleExpand = hasChildren
    ? () =>
        setExpanded((prev) => {
          const n = new Set(prev)
          if (n.has(task.id)) n.delete(task.id)
          else n.add(task.id)
          return n
        })
    : undefined

  return (
    <>
      <StaticListRow
        task={task}
        level={level}
        focused={focusedId === task.id}
        selected={selectedIds.has(task.id)}
        expanded={isExpanded}
        onFocus={() => setFocusedId(task.id)}
        onToggleExpand={onToggleExpand}
        onToggleSelect={(additive) => toggleSelection(task.id, additive)}
        users={users}
      />
      {isExpanded && hasChildren
        ? (task.subtasks ?? []).map((grand) => (
            <SubtaskBranch
              key={grand.id}
              task={grand}
              level={level + 1}
              focusedId={focusedId}
              selectedIds={selectedIds}
              expanded={expanded}
              setFocusedId={setFocusedId}
              setExpanded={setExpanded}
              toggleSelection={toggleSelection}
              users={users}
            />
          ))
        : null}
    </>
  )
}
