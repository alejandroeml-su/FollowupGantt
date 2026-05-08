'use client'

/**
 * Wave P9 · Agile Maturity (HU-9.6) — Vista del Backlog priorizable.
 *
 * Cumple los criterios de aceptación del backlog @PO:
 *   - Stories sin sprintId del proyecto, ordenadas por priority + position.
 *   - Drag-drop @dnd-kit para reordenar (persiste position).
 *   - Bulk assign "Mover a sprint S2" desde toolbar.
 *   - Filter por priority (status filtrado en query — solo no-DONE).
 *   - Link "Backlog" en ProjectDetail header.
 *
 * Acciones disponibles por fila:
 *   - Drag handle (arrastrar para reordenar).
 *   - Checkbox para multi-select.
 *   - Click en fila → abre el drawer de la tarea (futuro — por ahora link).
 *
 * Toolbar (sticky):
 *   - Selector "Mover seleccionadas a sprint…" (visible si hay selección).
 *   - Filtros: priority + epic.
 *   - Contador "N de M tasks".
 */

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  GripVertical,
  ChevronRight,
  CheckSquare,
  Square,
  ListTree,
  Rocket,
  Target as TargetIcon,
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { clsx } from 'clsx'
import {
  reorderBacklog,
  bulkAssignToSprint,
  type BacklogTask,
} from '@/lib/actions/backlog'
import { EpicBadge } from '@/components/epics/EpicBadge'
import { toast } from '@/components/interactions/Toaster'

type SprintOption = {
  id: string
  name: string
  startDate: string | null
  endDate: string | null
  capacity: number | null
}

type EpicOption = { id: string; name: string; color: string }

/**
 * Wave P9 follow-up demo · Sprint Backlog tabs.
 * Cada Sprint Backlog group trae su propio set de tasks ya asignadas al sprint.
 */
export type SprintBacklogGroup = {
  sprintId: string
  sprintName: string
  sprintGoal: string | null
  capacity: number | null
  startDate: string | null
  endDate: string | null
  tasks: BacklogTask[]
}

type Props = {
  project: { id: string; name: string }
  initialBacklog: BacklogTask[]
  sprints: SprintOption[]
  epics: EpicOption[]
  /** Wave P9 follow-up — Sprint Backlogs por tab. Si vacío, sólo Product Backlog. */
  sprintBacklogs?: SprintBacklogGroup[]
}

type ActiveView = 'PRODUCT' | string // sprintId

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-500/15 text-red-300 border-red-500/40',
  HIGH: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  MEDIUM: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  LOW: 'bg-secondary text-muted-foreground border-border',
}

export default function BacklogClient({
  project,
  initialBacklog,
  sprints,
  epics,
  sprintBacklogs = [],
}: Props) {
  const [productBacklog, setProductBacklog] = useState(initialBacklog)
  const [activeView, setActiveView] = useState<ActiveView>('PRODUCT')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [priorityFilter, setPriorityFilter] = useState<string>('')
  const [epicFilter, setEpicFilter] = useState<string>('')
  const [isPending, startTransition] = useTransition()

  // Source-of-truth de items según tab activa.
  const activeSprint = sprintBacklogs.find((s) => s.sprintId === activeView) ?? null
  const items = activeView === 'PRODUCT' ? productBacklog : activeSprint?.tasks ?? []
  const isProductBacklog = activeView === 'PRODUCT'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const filtered = useMemo(() => {
    return items.filter((t) => {
      if (priorityFilter && t.priority !== priorityFilter) return false
      if (epicFilter) {
        if (epicFilter === '__no_epic__' && t.epic) return false
        if (epicFilter !== '__no_epic__' && t.epic?.id !== epicFilter) return false
      }
      return true
    })
  }, [items, priorityFilter, epicFilter])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((t) => t.id)))
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    // Drag-drop sólo persiste en Product Backlog (reorderBacklog asume sprintId=null).
    // En Sprint Backlogs el reorder vive en el board del sprint (futuro).
    if (!isProductBacklog) return
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = productBacklog.findIndex((t) => t.id === active.id)
    const to = productBacklog.findIndex((t) => t.id === over.id)
    if (from < 0 || to < 0) return

    const next = arrayMove(productBacklog, from, to)
    setProductBacklog(next) // optimistic

    startTransition(async () => {
      try {
        await reorderBacklog({
          projectId: project.id,
          orderedTaskIds: next.map((t) => t.id),
        })
      } catch (err) {
        setProductBacklog(productBacklog) // rollback
        toast.error(err instanceof Error ? err.message : 'Error al reordenar')
      }
    })
  }

  function handleBulkAssign(sprintId: string) {
    if (selected.size === 0) return
    const ids = Array.from(selected)

    startTransition(async () => {
      try {
        const r = await bulkAssignToSprint({ taskIds: ids, sprintId })
        toast.success(`${r.count} tarea${r.count === 1 ? '' : 's'} movida${r.count === 1 ? '' : 's'} al sprint`)
        // Optimistic: remover del Product Backlog local. Para Sprint
        // Backlogs el server action revalida el path → router.refresh()
        // recargará el snapshot del sprint.
        if (isProductBacklog) {
          setProductBacklog((prev) => prev.filter((t) => !selected.has(t.id)))
        }
        setSelected(new Set())
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al asignar')
      }
    })
  }

  return (
    <>
      <header className="flex shrink-0 items-start justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> {project.name}
          </Link>
          <h1 className="mt-1 text-xl font-bold text-foreground">
            {isProductBacklog
              ? 'Product Backlog'
              : `Sprint Backlog · ${activeSprint?.sprintName ?? ''}`}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isProductBacklog
              ? 'Stories sin sprint, ordenadas por prioridad. Arrastra para reordenar y selecciona varias para mover a un sprint en bloque.'
              : activeSprint?.sprintGoal
                ? `🎯 ${activeSprint.sprintGoal}`
                : 'Tareas comprometidas en este sprint. Refinamiento desde Sprint Planning.'}
          </p>
          {/* Tab strip Product Backlog | Sprint Backlogs */}
          <div
            role="tablist"
            aria-label="Vistas de backlog"
            className="mt-3 flex flex-wrap gap-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={isProductBacklog}
              onClick={() => {
                setActiveView('PRODUCT')
                setSelected(new Set())
              }}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                isProductBacklog
                  ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/40'
                  : 'border border-border bg-input/40 text-muted-foreground hover:bg-input',
              )}
            >
              <ListTree className="h-3 w-3" />
              Product Backlog
              <span className="rounded bg-indigo-500/20 px-1.5 text-[10px] font-bold">
                {productBacklog.length}
              </span>
            </button>
            {sprintBacklogs.map((sb) => {
              const isActive = activeView === sb.sprintId
              return (
                <button
                  key={sb.sprintId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    setActiveView(sb.sprintId)
                    setSelected(new Set())
                  }}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                      : 'border border-border bg-input/40 text-muted-foreground hover:bg-input',
                  )}
                  title={
                    sb.sprintGoal
                      ? `${sb.sprintName} · 🎯 ${sb.sprintGoal}`
                      : sb.sprintName
                  }
                >
                  <Rocket className="h-3 w-3" />
                  {sb.sprintName}
                  <span
                    className={clsx(
                      'rounded px-1.5 text-[10px] font-bold',
                      isActive
                        ? 'bg-emerald-500/20'
                        : 'bg-secondary/60',
                    )}
                  >
                    {sb.tasks.length}
                  </span>
                  {sb.capacity != null && (
                    <span className="text-[10px] opacity-70">
                      / {sb.capacity} SP
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Wave P9 R2 (HU-9.7) — Sprint Planning UI dedicado para
              Backlog Refinement formal. Aparece sólo si hay sprints
              activos. */}
          {sprints.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  window.location.href = `/projects/${project.id}/sprints/${e.target.value}/planning`
                }
              }}
              aria-label="Abrir Sprint Planning"
              className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 py-1.5 text-xs font-semibold text-indigo-300 focus:border-primary focus:outline-none"
            >
              <option value="">Planificar sprint…</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <span className="text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'tarea' : 'tareas'}
            {filtered.length !== items.length && ` (de ${items.length})`}
          </span>
        </div>
      </header>

      {/* Toolbar sticky con filtros + bulk assign */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-subtle px-6 py-3">
        <button
          type="button"
          onClick={toggleSelectAll}
          aria-label="Seleccionar todas"
          className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-secondary"
        >
          {selected.size === filtered.length && filtered.length > 0 ? (
            <CheckSquare className="h-3.5 w-3.5 text-indigo-400" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
          {selected.size > 0 ? `${selected.size} seleccionadas` : 'Seleccionar'}
        </button>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          aria-label="Filtrar por prioridad"
          className="rounded-md border border-border bg-input px-2 py-1 text-xs text-input-foreground focus:border-primary focus:outline-none"
        >
          <option value="">Prioridad</option>
          <option value="CRITICAL">Crítica</option>
          <option value="HIGH">Alta</option>
          <option value="MEDIUM">Media</option>
          <option value="LOW">Baja</option>
        </select>

        {epics.length > 0 && (
          <select
            value={epicFilter}
            onChange={(e) => setEpicFilter(e.target.value)}
            aria-label="Filtrar por Epic"
            className="rounded-md border border-border bg-input px-2 py-1 text-xs text-input-foreground focus:border-primary focus:outline-none"
          >
            <option value="">Epic</option>
            <option value="__no_epic__">Sin Epic</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}

        {/* Bulk assign aparece solo si hay selección */}
        {selected.size > 0 && sprints.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Mover {selected.size} a:
            </span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) handleBulkAssign(e.target.value)
              }}
              disabled={isPending}
              aria-label="Asignar a sprint"
              className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-xs font-semibold text-indigo-300 focus:border-primary focus:outline-none disabled:opacity-60"
            >
              <option value="">Selecciona sprint…</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.capacity ? ` (cap: ${s.capacity} SP)` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Lista drag-drop */}
      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="mx-auto max-w-md rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <h2 className="text-base font-semibold text-foreground">
              {items.length === 0
                ? 'Backlog vacío'
                : 'Sin coincidencias'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {items.length === 0
                ? 'No hay Stories sin sprint en este proyecto. Crea Tasks de tipo Story sin asignar a sprint y aparecerán aquí.'
                : 'Ajusta los filtros para ver las tareas del backlog.'}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filtered.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-1.5">
                {filtered.map((task, idx) => (
                  <BacklogRow
                    key={task.id}
                    task={task}
                    index={idx}
                    selected={selected.has(task.id)}
                    onToggleSelect={() => toggleSelect(task.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </>
  )
}

function BacklogRow({
  task,
  index,
  selected,
  onToggleSelect,
}: {
  task: BacklogTask
  index: number
  selected: boolean
  onToggleSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-priority={task.priority}
      className={clsx(
        'group flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors',
        selected
          ? 'border-indigo-500/60 bg-indigo-500/5'
          : 'border-border hover:border-indigo-500/40',
      )}
    >
      <span className="w-6 shrink-0 text-right text-[10px] font-mono text-muted-foreground tabular-nums">
        {index + 1}
      </span>

      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Seleccionar ${task.title}`}
        className="h-4 w-4 cursor-pointer accent-indigo-500"
        onClick={(e) => e.stopPropagation()}
      />

      <button
        type="button"
        {...attributes}
        {...(listeners as Record<string, unknown>)}
        aria-label="Arrastrar para reordenar"
        className="cursor-grab text-muted-foreground active:cursor-grabbing hover:text-foreground"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {task.mnemonic && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground border border-border/40">
              {task.mnemonic}
            </span>
          )}
          <span className="truncate text-sm font-medium text-foreground">
            {task.title}
          </span>
          {task.epic && (
            <EpicBadge
              name={task.epic.name}
              color={task.epic.color}
              size="xs"
              className="shrink-0"
            />
          )}
        </div>
        {task.description && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
            {task.description}
          </p>
        )}
      </div>

      <span
        className={clsx(
          'shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold uppercase',
          PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.LOW,
        )}
      >
        {task.priority}
      </span>

      {task.storyPoints !== null && task.storyPoints !== undefined && (
        <span
          className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-foreground border border-border/40"
          title="Story Points"
        >
          {task.storyPoints} SP
        </span>
      )}

      <span className="shrink-0 text-[11px] text-muted-foreground">
        {task.assignee?.name ?? 'Sin asignar'}
      </span>

      <Link
        href={`/list?taskId=${encodeURIComponent(task.id)}`}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-secondary hover:text-foreground"
        aria-label="Ver detalle"
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
    </li>
  )
}
