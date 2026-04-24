'use client'

import { useMemo, useState } from 'react'
import { Network, ZoomIn, ZoomOut, Share2 } from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import { TaskFiltersBar } from './TaskFiltersBar'
import { EMPTY_TASK_FILTERS, matchesFilters, type TaskFilters } from '@/lib/taskFilters'

type MindTask = SerializedTask & { subtasks?: SerializedTask[] }
type MindProject = {
  id: string
  name: string
  areaId?: string | null
  tasks: MindTask[]
}

type Props = {
  projects: MindProject[]
  projectCatalog: { id: string; name: string; areaId?: string | null }[]
  users: { id: string; name: string }[]
  gerencias: { id: string; name: string }[]
  areas: { id: string; name: string; gerenciaId?: string | null }[]
}

export function MindMapsBoardClient({
  projects,
  projectCatalog,
  users,
  gerencias,
  areas,
}: Props) {
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)

  const visibleProjects = useMemo(() => {
    return projects
      .map(p => {
        const matchedTasks = p.tasks
          .map(t => {
            const subs = (t.subtasks ?? []).filter(s => matchesFilters(s, filters))
            const selfMatches = matchesFilters(t, filters)
            if (selfMatches || subs.length > 0) {
              return { ...t, subtasks: subs } as MindTask
            }
            return null
          })
          .filter((x): x is MindTask => x !== null)

        // Filtro de proyecto: si hay projectId filter → solo ese proyecto
        if (filters.projectId && p.id !== filters.projectId) return null
        // Filtro de área: se ignora aquí (cae por cascada cuando hay tareas filtradas)
        if (matchedTasks.length === 0 && filters.projectId) {
          return { ...p, tasks: [] }
        }
        return { ...p, tasks: matchedTasks }
      })
      .filter((p): p is MindProject => p !== null)
      .filter(p => p.tasks.length > 0 || !hasTaskLevelFilter(filters))
  }, [projects, filters])

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50 z-10">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Network className="h-5 w-5 text-indigo-400" />
            Mind Maps (Supabase SSR)
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Estructura lógica y desglose de trabajo jerárquico</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-md bg-secondary p-1 border border-border">
            <button className="p-1.5 text-muted-foreground hover:text-white rounded hover:bg-secondary/80 transition-colors">
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="px-2 text-xs font-medium text-muted-foreground">100%</span>
            <button className="p-1.5 text-muted-foreground hover:text-white rounded hover:bg-secondary/80 transition-colors">
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
          <button className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors">
            <Share2 className="h-4 w-4" />
            Compartir
          </button>
        </div>
      </header>

      <TaskFiltersBar
        value={filters}
        onChange={setFilters}
        gerencias={gerencias}
        areas={areas}
        projects={projectCatalog}
        users={users}
      />

      <div className="flex-1 relative bg-[#0B1120] overflow-auto">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative min-h-[800px] min-w-[1200px] p-20 flex justify-center items-center">
          {visibleProjects.length === 0 ? (
            <div className="text-muted-foreground bg-card p-4 rounded-xl border border-border">
              No hay proyectos o tareas que coincidan con los filtros actuales.
            </div>
          ) : (
            <div className="flex flex-col items-center gap-12">
              {visibleProjects.map(project => (
                <div key={project.id} className="flex flex-col items-center">
                  <div className="bg-indigo-500/10 border-2 border-indigo-500 rounded-2xl p-6 w-64 text-center shadow-[0_0_30px_rgba(99,102,241,0.2)] z-10 backdrop-blur-sm">
                    <h2 className="text-lg font-bold text-white mb-1">{project.name}</h2>
                    <p className="text-xs text-indigo-300">Proyecto Raíz</p>
                  </div>

                  {project.tasks.length > 0 && <div className="w-0.5 h-12 bg-border" />}

                  <div className="flex gap-8 relative">
                    {project.tasks.length > 1 && (
                      <div
                        className="absolute top-0 left-[50%] right-[50%] h-0.5 bg-border"
                        style={{ width: `calc(100% - ${100 / project.tasks.length}%)`, transform: 'translateX(-50%)' }}
                      />
                    )}

                    {project.tasks.map(task => (
                      <div key={task.id} className="flex flex-col items-center relative">
                        {project.tasks.length > 1 && <div className="w-0.5 h-8 bg-border" />}

                        <div className="bg-secondary border border-border rounded-xl p-4 w-48 text-center shadow-lg z-10 hover:border-indigo-400 transition-colors cursor-pointer">
                          <p className="text-sm font-semibold text-foreground truncate">{task.title}</p>
                          <span className="inline-block mt-2 px-2 py-0.5 bg-card rounded text-[10px] text-muted-foreground">
                            {task.status}
                          </span>
                        </div>

                        {(task.subtasks?.length ?? 0) > 0 && <div className="w-0.5 h-8 bg-border" />}

                        <div className="flex flex-col gap-4">
                          {(task.subtasks ?? []).map(sub => (
                            <div key={sub.id} className="flex items-center relative">
                              <div className="w-4 h-0.5 bg-border absolute -left-4" />
                              <div className="bg-card border border-border rounded-lg p-3 w-40 text-center shadow-md hover:border-border transition-colors cursor-pointer">
                                <p className="text-xs font-medium text-foreground/90 truncate">{sub.title}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function hasTaskLevelFilter(f: TaskFilters): boolean {
  return !!(f.status || f.type || f.priority || f.assigneeId || f.gerenciaId || f.areaId)
}
