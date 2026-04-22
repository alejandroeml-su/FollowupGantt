'use client';

import { useState } from 'react';
import { Plus, MoreHorizontal, GripVertical } from 'lucide-react';

const initialColumns = [
  {
    id: 'todo',
    title: 'To Do',
    wipLimit: null,
    tasks: [
      { id: '1', title: 'Definir SLA de ITIL', priority: 'HIGH', type: 'ITIL_TICKET' },
      { id: '2', title: 'Diseñar arquitectura base', priority: 'CRITICAL', type: 'PMI_TASK' },
    ]
  },
  {
    id: 'in-progress',
    title: 'In Progress',
    wipLimit: 3,
    tasks: [
      { id: '3', title: 'Migrar frontend a React', priority: 'MEDIUM', type: 'AGILE_STORY' },
      { id: '4', title: 'Configurar Prisma ORM', priority: 'HIGH', type: 'AGILE_STORY' },
    ]
  },
  {
    id: 'review',
    title: 'Review',
    wipLimit: 2,
    tasks: [
      { id: '5', title: 'Revisión código Supabase', priority: 'LOW', type: 'AGILE_STORY' },
    ]
  },
  {
    id: 'done',
    title: 'Done',
    wipLimit: null,
    tasks: [
      { id: '6', title: 'Estructura de BD Híbrida', priority: 'HIGH', type: 'PMI_TASK' },
    ]
  }
];

export default function KanbanBoard() {
  const [columns] = useState(initialColumns);

  const getPriorityColor = (priority: string) => {
    switch(priority) {
      case 'CRITICAL': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'HIGH': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      case 'MEDIUM': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'LOW': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      default: return 'bg-slate-500/10 text-slate-500 border-slate-500/20';
    }
  };

  const getTypeColor = (type: string) => {
    switch(type) {
      case 'AGILE_STORY': return 'bg-indigo-500';
      case 'PMI_TASK': return 'bg-emerald-500';
      case 'ITIL_TICKET': return 'bg-rose-500';
      default: return 'bg-slate-500';
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-slate-900/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Tablero Kanban</h1>
          <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
            <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-indigo-500 mr-1.5"></div> Agile Story</span>
            <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5"></div> PMI Task</span>
            <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-rose-500 mr-1.5"></div> ITIL Ticket</span>
          </div>
        </div>
        <button className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors">
          <Plus className="h-4 w-4" />
          Nueva Tarea
        </button>
      </header>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-8">
        <div className="flex h-full items-start gap-6">
          {columns.map((column) => {
            const isOverWip = column.wipLimit && column.tasks.length > column.wipLimit;
            
            return (
              <div key={column.id} className="flex h-full w-80 shrink-0 flex-col rounded-xl bg-slate-900/80 border border-slate-800">
                <div className={`flex items-center justify-between p-4 border-b border-slate-800/50 ${isOverWip ? 'bg-red-500/5 rounded-t-xl' : ''}`}>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-200">{column.title}</h3>
                    <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium ${isOverWip ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30' : 'bg-slate-800 text-slate-400'}`}>
                      {column.tasks.length} {column.wipLimit ? `/ ${column.wipLimit}` : ''}
                    </span>
                  </div>
                  <button className="text-slate-500 hover:text-slate-300">
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {column.tasks.map((task) => (
                    <div 
                      key={task.id} 
                      className="group relative flex cursor-grab flex-col gap-3 rounded-lg border border-slate-700/50 bg-slate-800 p-4 shadow-sm hover:border-indigo-500/50 hover:shadow-md transition-all"
                    >
                      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${getTypeColor(task.type)} opacity-70`} />
                      
                      <div className="flex items-start justify-between pl-2">
                        <p className="text-sm font-medium text-slate-200 leading-snug">{task.title}</p>
                        <GripVertical className="h-4 w-4 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      
                      <div className="flex items-center justify-between pl-2 mt-2">
                        <span className="text-xs text-slate-500">#{task.id}</span>
                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${getPriorityColor(task.priority)}`}>
                          {task.priority}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
