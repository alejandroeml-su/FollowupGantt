import { Table as TableIcon, Download, Search, MessageSquare } from 'lucide-react';
import prisma from "@/lib/prisma";
import TaskClickable from "@/components/TaskClickable";
import { serializeTask } from "@/lib/types";

export const dynamic = "force-dynamic";



export default async function TableDBPage() {
  const tasks = await prisma.task.findMany({
    include: {
      project: true,
      assignee: true,
      comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-slate-900/50">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <TableIcon className="h-5 w-5 text-indigo-400" />
            Table DB View (Supabase SSR)
          </h1>
          <p className="mt-1 text-xs text-slate-400">Vista de base de datos relacional para inventario y metadatos</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Buscar en BD..." 
              className="w-64 rounded-md border border-slate-700 bg-slate-900 py-1.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-800/50 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="border-b border-slate-700 px-4 py-3">ID</th>
                  <th className="border-b border-slate-700 px-4 py-3">Título</th>
                  <th className="border-b border-slate-700 px-4 py-3">Proyecto</th>
                  <th className="border-b border-slate-700 px-4 py-3">Tipo</th>
                  <th className="border-b border-slate-700 px-4 py-3">Estado</th>
                  <th className="border-b border-slate-700 px-4 py-3">Prioridad</th>
                  <th className="border-b border-slate-700 px-4 py-3">Asignado</th>
                  <th className="border-b border-slate-700 px-4 py-3">Progreso</th>
                  <th className="border-b border-slate-700 px-4 py-3 text-center">💬</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900">
                {tasks.map(task => {
                  const serialized = serializeTask(task);
                  const commentCount = task.comments?.length || 0;

                  return (
                    <TaskClickable key={task.id} task={serialized} as="tr" className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-[10px] text-slate-500" title={task.id}>
                          {task.id.split('-')[0]}...
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-200">
                          {task.title}
                        </td>
                        <td className="px-4 py-3">
                          {task.project?.name || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-400">
                            {task.type.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <div className={`h-1.5 w-1.5 rounded-full ${
                              task.status === 'DONE' ? 'bg-emerald-500' :
                              task.status === 'IN_PROGRESS' ? 'bg-indigo-500' : 'bg-slate-500'
                            }`} />
                            {task.status}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[10px] uppercase font-semibold">
                          <span className={`${
                            task.priority === 'CRITICAL' ? 'text-red-400' :
                            task.priority === 'HIGH' ? 'text-amber-400' : 'text-slate-400'
                          }`}>
                            {task.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {task.assignee?.name || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                              <div 
                                className="h-full bg-indigo-500" 
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500">{task.progress}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {commentCount > 0 ? (
                            <span className="flex items-center justify-center gap-0.5 text-[10px] text-indigo-400">
                              <MessageSquare className="h-3 w-3" /> {commentCount}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-600">—</span>
                          )}
                        </td>
                    </TaskClickable>
                  );
                })}
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                      No hay registros en la base de datos
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-500">
            <span>Mostrando {tasks.length} registros</span>
            <div className="flex gap-2">
              <button className="hover:text-slate-300">Anterior</button>
              <button className="hover:text-slate-300">Siguiente</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
