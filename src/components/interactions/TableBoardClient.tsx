'use client'

import { useState } from 'react'
import { Table as TableIcon, Download, Search, MessageSquare, ChevronRight } from 'lucide-react'
import { serializeTask, type SerializedTask } from '@/lib/types'
import { useUIStore } from '@/lib/stores/ui'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'

type Props = {
  tasks: (SerializedTask & { commentCount: number })[]
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
}

export function TableBoardClient({ tasks, projects, users }: Props) {
  const [search, setSearch] = useState('')
  const drawerTaskId = useUIStore((s) => s.drawerTaskId)
  const openDrawer = useUIStore((s) => s.openDrawer)

  const filtered = tasks.filter(t => 
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.id.toLowerCase().includes(search.toLowerCase()) ||
    t.project?.name.toLowerCase().includes(search.toLowerCase())
  )

  const drawerTask = tasks.find(t => t.id === drawerTaskId)

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-slate-900/50">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <TableIcon className="h-5 w-5 text-indigo-400" />
            Inventario General de Tareas
          </h1>
          <p className="mt-1 text-xs text-slate-400">Metadatos, jerarquía y reportería técnica</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Buscar por título, proyecto o ID..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-80 rounded-md border border-slate-700 bg-slate-900 py-1.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>
          <button className="flex items-center gap-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors border border-slate-700">
            <Download className="h-4 w-4" />
            Exportar CSV
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300 border-collapse">
              <thead className="bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="border-b border-slate-700 px-4 py-3">ID</th>
                  <th className="border-b border-slate-700 px-4 py-3">Título</th>
                  <th className="border-b border-slate-700 px-4 py-3">Proyecto</th>
                  <th className="border-b border-slate-700 px-4 py-3">Tipo</th>
                  <th className="border-b border-slate-700 px-4 py-3 text-center">Estado</th>
                  <th className="border-b border-slate-700 px-4 py-3 text-center">Prioridad</th>
                  <th className="border-b border-slate-700 px-4 py-3">Asignado</th>
                  <th className="border-b border-slate-700 px-4 py-3">Progreso</th>
                  <th className="border-b border-slate-700 px-4 py-3 text-center">💬</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900">
                {filtered.map(task => (
                  <tr 
                    key={task.id} 
                    onClick={() => openDrawer(task.id)}
                    className={`group hover:bg-indigo-500/5 cursor-pointer transition-colors ${drawerTaskId === task.id ? 'bg-indigo-500/10' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
                      {task.id.split('-')[0]}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-200 group-hover:text-indigo-300">
                      {task.title}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {task.project?.name || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-400 border border-slate-700/50">
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
                        task.priority === 'CRITICAL' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        task.priority === 'HIGH' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 
                        'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">
                          {task.assignee?.name?.charAt(0) || '?'}
                        </div>
                        <span className="text-xs truncate max-w-[100px]">{task.assignee?.name || '-'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                          <div 
                            className="h-full bg-indigo-500 transition-all duration-500" 
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 w-6">{task.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.commentCount > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-indigo-400 font-bold">
                          <MessageSquare className="h-3 w-3" /> {task.commentCount}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-500 bg-slate-900/50">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="h-8 w-8 text-slate-700" />
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
              <span className="text-slate-300">
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
