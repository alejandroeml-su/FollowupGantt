'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Table as TableIcon, Download, Search, MessageSquare, Settings2 } from 'lucide-react'
import { type SerializedTask } from '@/lib/types'
import { useUIStore } from '@/lib/stores/ui'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'
import { NewTaskButton } from './NewTaskButton'
import { TaskFiltersBar } from './TaskFiltersBar'
import { EMPTY_TASK_FILTERS, filterTasks, type TaskFilters } from '@/lib/taskFilters'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { computeProgressWithSource } from '@/lib/progress/rollup'
import { useTaskRealtimeRefresh } from '@/lib/realtime/use-task-realtime'
import { EpicBadge } from '@/components/epics/EpicBadge'
import { useTableColumnPrefs } from '@/lib/views/use-table-column-prefs'
import { getColumnDef, type TableColumnId } from '@/lib/views/table-columns'
import { TableColumnsConfigurator } from '@/components/views/TableColumnsConfigurator'

type ParentOption = Pick<SerializedTask, 'id' | 'title' | 'mnemonic'> & {
  project?: { id: string; name: string } | null
  projectId?: string
}

type Props = {
  tasks: (SerializedTask & {
    commentCount: number
    /** Profundidad en el árbol (0 = raíz). El page.tsx lo inyecta tras
     * `flattenTaskTree`. Default 0 para callers legacy. */
    depth?: number
    ancestors?: string[]
  })[]
  projects: { id: string; name: string; areaId?: string | null }[]
  users: { id: string; name: string }[]
  allTasks?: ParentOption[]
  gerencias?: { id: string; name: string }[]
  areas?: { id: string; name: string; gerenciaId?: string | null }[]
  /** Wave P9 — Epics activas para filtro. */
  epics?: { id: string; name: string; color: string; projectId: string }[]
  /**
   * Wave P7 · C-DEBT-2 — Identidad del usuario actual para el drawer
   * (presence + edit locks). Forwardeada a `<TaskDrawerContent>`.
   */
  currentUser?: CurrentUserPresence | null
}

export function TableBoardClient({
  tasks,
  projects,
  users,
  allTasks = [],
  gerencias = [],
  areas = [],
  epics = [],
  currentUser = null,
}: Props) {
  // Refresca la vista cuando cualquier tarea cambia en la BD (postgres CDC
  // vía Supabase Realtime). Mantiene los rollups de progress al día sin
  // recargar la página cuando otro tab/usuario muta tareas.
  useTaskRealtimeRefresh()

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)
  const drawerTaskId = useUIStore((s) => s.drawerTaskId)
  const openDrawer = useUIStore((s) => s.openDrawer)

  const { prefs: columnPrefs, setPrefs: setColumnPrefs } = useTableColumnPrefs()
  const [showColumnsConfig, setShowColumnsConfig] = useState(false)
  const columnsButtonRef = useRef<HTMLDivElement | null>(null)

  // Cierra el popover de columnas al hacer click fuera. Patrón estándar
  // sin librería extra.
  useEffect(() => {
    if (!showColumnsConfig) return
    function onDocClick(e: MouseEvent) {
      if (
        columnsButtonRef.current &&
        !columnsButtonRef.current.contains(e.target as Node)
      ) {
        setShowColumnsConfig(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [showColumnsConfig])

  // Lista efectiva de columnas a renderizar: respeta orden del usuario
  // y filtra por las visibles.
  const visibleColumns = useMemo(() => {
    const visibleSet = new Set(columnPrefs.visible)
    return columnPrefs.order
      .filter((id) => visibleSet.has(id))
      .map((id) => getColumnDef(id))
      .filter((c): c is NonNullable<typeof c> => c !== null)
  }, [columnPrefs])

  const filtered = useMemo(() => {
    const afterFilters = filterTasks(tasks, filters)
    if (!search.trim()) return afterFilters
    const q = search.toLowerCase()
    return afterFilters.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      (t.project?.name.toLowerCase().includes(q) ?? false)
    )
  }, [tasks, filters, search])

  const drawerTask = tasks.find(t => t.id === drawerTaskId)

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <TableIcon className="h-5 w-5 text-indigo-400" />
            Inventario General de Tareas
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Metadatos, jerarquía y reportería técnica</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Buscar por título, proyecto o ID..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-80 rounded-md border border-border bg-card py-1.5 pl-9 pr-3 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-ring transition-all"
            />
          </div>
          <button className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-foreground/90 hover:bg-secondary/80 transition-colors border border-border">
            <Download className="h-4 w-4" />
            Exportar CSV
          </button>
          <div className="relative" ref={columnsButtonRef}>
            <button
              type="button"
              onClick={() => setShowColumnsConfig((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={showColumnsConfig}
              className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-foreground/90 hover:bg-secondary/80 transition-colors border border-border"
              title="Configurar columnas"
            >
              <Settings2 className="h-4 w-4" />
              Columnas
            </button>
            {showColumnsConfig && (
              <div className="absolute right-0 top-full z-30 mt-2">
                <TableColumnsConfigurator
                  prefs={columnPrefs}
                  onChange={setColumnPrefs}
                  onClose={() => setShowColumnsConfig(false)}
                />
              </div>
            )}
          </div>
          <NewTaskButton projects={projects} users={users} allTasks={allTasks} />
        </div>
      </header>

      <TaskFiltersBar
        value={filters}
        onChange={setFilters}
        gerencias={gerencias}
        areas={areas}
        projects={projects}
        users={users}
        epics={epics}
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-foreground/90 border-collapse">
              <thead className="bg-secondary/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  {visibleColumns.map((col) => (
                    <th
                      key={col.id}
                      className={`border-b border-border px-4 py-3 ${
                        col.align === 'center'
                          ? 'text-center'
                          : col.align === 'right'
                            ? 'text-right'
                            : ''
                      }`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {filtered.map((task) => (
                  <tr
                    key={task.id}
                    onClick={() => openDrawer(task.id)}
                    className={`group hover:bg-indigo-500/5 cursor-pointer transition-colors ${drawerTaskId === task.id ? 'bg-indigo-500/10' : ''}`}
                  >
                    {visibleColumns.map((col) => (
                      <td
                        key={col.id}
                        className={`px-4 py-3 ${
                          col.align === 'center'
                            ? 'text-center'
                            : col.align === 'right'
                              ? 'text-right'
                              : ''
                        } ${cellClassFor(col.id)}`}
                      >
                        {renderCell(col.id, task)}
                      </td>
                    ))}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={visibleColumns.length || 1}
                      className="px-4 py-12 text-center text-muted-foreground bg-subtle/50"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-8 w-8 text-foreground" />
                        <p>No se encontraron tareas con los filtros actuales</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
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
        currentUser={currentUser}
      >
        {drawerTask ? (
          <TaskDrawerContent
            task={drawerTask}
            projects={projects}
            users={users}
            currentUser={currentUser}
          />
        ) : null}
      </TaskDrawer>
    </>
  )
}

/**
 * Tabla de renderizado de celdas indexada por `TableColumnId`. Cada
 * caso devuelve el JSX para esa columna. Mantenido fuera del componente
 * para que React no recree los closures en cada render.
 */
function renderCell(
  id: TableColumnId,
  task: SerializedTask & { commentCount: number; depth?: number },
): React.ReactNode {
  switch (id) {
    case 'id':
      return (
        <span className="font-mono text-[10px] text-muted-foreground">
          {task.id.split('-')[0]}
        </span>
      )
    case 'title': {
      // Preserva la indentación de #106 (jerarquía recursiva): si la
      // tarea es subtarea (depth>0), aplica padding-left proporcional
      // y un prefix `└─` para señalar el anidamiento visualmente.
      const depth = task.depth ?? 0
      return (
        <span
          className="inline-flex items-center gap-2 font-medium text-foreground group-hover:text-indigo-300"
          style={{ paddingLeft: `${depth * 1.25}rem` }}
        >
          {depth > 0 && (
            <span
              className="text-muted-foreground/60"
              aria-hidden
              title={`Subtarea nivel ${depth}`}
            >
              └─
            </span>
          )}
          {task.title}
        </span>
      )
    }
    case 'project':
      return (
        <span className="text-muted-foreground">
          {task.project?.name || '-'}
        </span>
      )
    case 'epic':
      return task.epic ? (
        <EpicBadge name={task.epic.name} color={task.epic.color} size="sm" />
      ) : (
        <span className="text-[10px] text-muted-foreground">—</span>
      )
    case 'type':
      return (
        <span className="rounded bg-secondary px-2 py-0.5 text-[10px] uppercase text-muted-foreground border border-border/50">
          {task.type.replace('_', ' ')}
        </span>
      )
    case 'status':
      return (
        <div className="flex items-center justify-center gap-1.5">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              task.status === 'DONE'
                ? 'bg-emerald-500'
                : task.status === 'IN_PROGRESS'
                  ? 'bg-indigo-500'
                  : task.status === 'REVIEW'
                    ? 'bg-amber-500'
                    : 'bg-slate-500'
            }`}
          />
          <span className="text-xs">{task.status}</span>
        </div>
      )
    case 'priority':
      return (
        <span
          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
            task.priority === 'CRITICAL'
              ? 'bg-red-500/15 text-red-300 border-red-500/40'
              : task.priority === 'HIGH'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : task.priority === 'MEDIUM'
                  ? 'bg-blue-500/15 text-blue-300 border-blue-500/40'
                  : 'bg-secondary text-muted-foreground border-border'
          }`}
        >
          {task.priority}
        </span>
      )
    case 'assignee':
      return (
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-secondary flex items-center justify-center text-[10px]">
            {task.assignee?.name?.charAt(0) || '?'}
          </div>
          <span className="text-xs truncate max-w-[100px]">
            {task.assignee?.name || '-'}
          </span>
        </div>
      )
    case 'progress': {
      const info = computeProgressWithSource(task)
      return (
        <div
          className="flex items-center gap-2 min-w-[100px]"
          title={
            info.derived
              ? `${info.percent}% (promedio de ${info.childCount} subtarea${info.childCount === 1 ? '' : 's'})`
              : `${info.percent}%`
          }
        >
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className={
                info.percent >= 100
                  ? 'h-full bg-emerald-500 transition-all duration-500'
                  : info.percent >= 50
                    ? 'h-full bg-indigo-500 transition-all duration-500'
                    : 'h-full bg-amber-500 transition-all duration-500'
              }
              style={{ width: `${info.percent}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground w-6 tabular-nums">
            {info.percent}%
          </span>
        </div>
      )
    }
    case 'comments':
      return task.commentCount > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400 font-bold">
          <MessageSquare className="h-3 w-3" /> {task.commentCount}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground">—</span>
      )
    case 'startDate':
      return (
        <span className="text-xs text-muted-foreground">
          {formatDate(task.startDate)}
        </span>
      )
    case 'endDate':
      return (
        <span className="text-xs text-muted-foreground">
          {formatDate(task.endDate)}
        </span>
      )
    case 'tags':
      return task.tags && task.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{task.tags.length - 3}
            </span>
          )}
        </div>
      ) : (
        <span className="text-[10px] text-muted-foreground">—</span>
      )
    case 'createdAt':
      return (
        <span className="text-xs text-muted-foreground">
          {formatDate(task.createdAt)}
        </span>
      )
    case 'updatedAt':
      return (
        <span className="text-xs text-muted-foreground">
          {formatDate(task.updatedAt)}
        </span>
      )
    default:
      return null
  }
}

/**
 * Clase Tailwind extra que aplica a la celda según la columna. Por
 * ahora sólo usado para que la columna Título tenga `font-medium`,
 * pero se mantiene como hook para futuras decoraciones.
 */
function cellClassFor(id: TableColumnId): string {
  if (id === 'title') return 'font-medium text-foreground'
  if (id === 'project') return 'text-muted-foreground'
  return ''
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString()
  } catch {
    return '—'
  }
}
