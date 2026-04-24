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
import { useTaskShortcuts } from '@/lib/hooks/useTaskShortcuts'
import StatusSelector from '@/components/StatusSelector'
import { TaskWithContextMenu } from './TaskContextMenuItems'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'

type Props = {
  tasks: (SerializedTask & { subtasks?: SerializedTask[] })[]
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  DONE: <CheckCircle2 className="h-4 w-4" />,
  IN_PROGRESS: <Clock className="h-4 w-4" />,
}

const STATUS_COLOR: Record<string, string> = {
  TODO: 'text-slate-400',
  IN_PROGRESS: 'text-indigo-400',
  DONE: 'text-emerald-400',
  REVIEW: 'text-amber-400',
}

const PRIORITY_COLOR: Record<string, string> = {
  LOW: 'text-slate-400',
  MEDIUM: 'text-blue-400',
  HIGH: 'text-amber-400',
  CRITICAL: 'text-red-400',
}

export function ListBoardClient({ tasks }: Props) {
  const [items, setItems] = useState(tasks)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(tasks[0]?.id ?? null)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tasks.filter((t) => t.subtasks?.length).map((t) => t.id)),
  )

  const selectedIds = useUIStore((s) => s.selectedIds)
  const toggleSelection = useUIStore((s) => s.toggleSelection)
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
      <div className="divide-y divide-slate-800/50">
        <div className="flex items-center bg-slate-800/20 px-4 py-2">
          <ChevronDown className="mr-2 h-4 w-4 text-slate-400" />
          <span className="rounded border border-indigo-500/20 bg-indigo-500/20 px-2 py-0.5 text-xs font-semibold text-indigo-400">
            ALL TASKS
          </span>
          <span className="ml-2 text-xs text-slate-500">
            {items.length} tareas
          </span>
          <span className="ml-auto text-[10px] text-slate-500">
            Shift + / atajos · / buscar · T nueva tarea
          </span>
        </div>

        {items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            No hay tareas. Usa el formulario de arriba para crear la primera.
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((task) => (
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
              <div className="rounded-lg border border-indigo-500/50 bg-slate-800 px-4 py-2 shadow-xl">
                <p className="truncate text-sm text-slate-200">
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
              <span className="text-slate-300">
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
        {drawerTask ? <TaskDrawerContent task={drawerTask} /> : null}
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
  const priorityColor = PRIORITY_COLOR[task.priority] ?? 'text-slate-400'
  const statusColor = STATUS_COLOR[task.status] ?? 'text-slate-400'
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

  return (
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
            ? 'border-indigo-500 bg-slate-800/60 outline-2 outline-indigo-500'
            : selected
              ? 'border-indigo-500/50 bg-indigo-500/5'
              : 'border-transparent hover:border-indigo-500 hover:bg-slate-800/50',
        )}
      >
        <div
          className="col-span-4 flex items-center"
          style={{ paddingLeft: `${level * 1.5}rem` }}
        >
          {dragHandle}

          {hasSubs ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand?.()
              }}
              aria-label={expanded ? 'Colapsar' : 'Expandir'}
              className="mr-1 rounded p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
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
          <span className="truncate font-medium text-slate-200 group-hover:text-indigo-300">
            {task.title}
          </span>
          {commentCount > 0 && (
            <span className="ml-2 flex items-center gap-0.5 text-[10px] text-slate-500">
              <MessageSquare className="h-3 w-3" /> {commentCount}
            </span>
          )}
        </div>

        <div className="col-span-2 flex items-center">
          <UserCircle2 className="mr-2 h-4 w-4 text-slate-400" />
          <span className="truncate text-xs text-slate-300">
            {task.assignee?.name ?? 'Sin Asignar'}
          </span>
        </div>

        <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
          <StatusSelector taskId={task.id} currentStatus={task.status} />
        </div>

        <div className="col-span-2 flex items-center text-xs text-slate-400">
          <Calendar className="mr-2 h-3.5 w-3.5" />
          {dateStr}
        </div>

        <div className="col-span-1 flex justify-center">
          <Flag className={clsx('h-4 w-4', priorityColor)} />
        </div>

        <div className="col-span-1 flex justify-center text-xs text-slate-500">
          #{task.id.substring(0, 4)}
        </div>
      </div>
      {children}
    </TaskWithContextMenu>
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
          className="mr-1 cursor-grab text-slate-600 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
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
