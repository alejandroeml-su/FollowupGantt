'use client'

import { useMemo, useState } from 'react'
import { Table as TableIcon, Download, Search, MessageSquare, ChevronRight } from 'lucide-react'
import { type SerializedTask } from '@/lib/types'
import { useUIStore } from '@/lib/stores/ui'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'
import { NewTaskButton } from './NewTaskButton'
import { TaskFiltersBar } from './TaskFiltersBar'
import { EMPTY_TASK_FILTERS, filterTasks, type TaskFilters } from '@/lib/taskFilters'

type ParentOption = Pick<SerializedTask, 'id' | 'title' | 'mnemonic'> & {
  project?: { id: string; name: string } | null
  projectId?: string
}

type Props = {
  tasks: (SerializedTask & { commentCount: number })[]
  projects: { id: string; name: string; areaId?: string | null }[]
  users: { id: string; name: string }[]
  allTasks?: ParentOption[]
  gerencias?: { id: string; name: string }[]
  areas?: { id: string; name: string; gerenciaId?: string | null }[]
}

export function TableBoardClient({
  tasks,
  projects,
  users,
  allTasks = [],
  gerencias = [],
  areas = [],
}: Props) {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)
  const drawerTaskId = useUIStore((s) => s.drawerTaskId)
  const openDrawer = useUIStore((s) => s.openDrawer)

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
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-foreground/90 border-collapse">
              <thead className="bg-secondary/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="border-b border-border px-4 py-3">ID</th>
                  <th className="border-b border-border px-4 py-3">Título</th>
                  <th className="border-b border-border px-4 py-3">Proyecto</th>
                  <th className="border-b border-border px-4 py-3">Tipo</th>
                  <th className="border-b border-border px-4 py-3 text-center">Estado</th>
                  <th className="border-b border-border px-4 py-3 text-center">Prioridad</th>
                  <th className="border-b border-border px-4 py-3">Asignado</th>
                  <th className="border-b border-border px-4 py-3">Progreso</th>
                  <th className="border-b border-border px-4 py-3 text-center">💬</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {filtered.map(task => (
                  <tr 
                    key={task.id} 
                    onClick={() => openDrawer(task.id)}
                    className={`group hover:bg-indigo-500/5 cursor-pointer transition-colors ${drawerTaskId === task.id ? 'bg-indigo-500/10' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">
                      {task.id.split('-')[0]}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground group-hover:text-indigo-300">
                      {task.title}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {task.project?.name || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-secondary px-2 py-0.5 text-[10px] uppercase text-muted-foreground border border-border/50">
                        {task.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className={`h-1.5 w-1.5 rounded-full ${
                          task.status === 'DONE' ? 'bg-emerald-500' :
                          task.status === 'IN_PROGRESS' ? 'bg-indigo-500' : 'bg-slate-500'
                        }`} />
                        <span className="text-xs">{task.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                        task.priority === 'CRITICAL' ? 'bg-red-500/15 text-red-300 border-red-500/40' :
                        task.priority === 'HIGH' ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' :
                        task.priority === 'MEDIUM' ? 'bg-blue-500/15 text-blue-300 border-blue-500/40' :
                        'bg-secondary text-muted-foreground border-border'
                      }`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded-full bg-secondary flex items-center justify-center text-[10px]">
                          {task.assignee?.name?.charAt(0) || '?'}
                        </div>
                        <span className="text-xs truncate max-w-[100px]">{task.assignee?.name || '-'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div 
                            className="h-full bg-indigo-500 transition-all duration-500" 
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-6">{task.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.commentCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400 font-bold">
                          <MessageSquare className="h-3 w-3" /> {task.commentCount}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground bg-subtle/50">
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
