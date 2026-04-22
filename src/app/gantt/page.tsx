'use client';

import { Calendar, ChevronLeft, ChevronRight, Filter } from 'lucide-react';

const mockTasks = [
  { id: '1', title: 'Planificación Híbrida', start: 1, duration: 3, type: 'PMI_TASK', progress: 100 },
  { id: '2', title: 'Diseñar arquitectura base', start: 3, duration: 4, type: 'AGILE_STORY', progress: 60 },
  { id: '3', title: 'Configurar Prisma ORM', start: 6, duration: 2, type: 'AGILE_STORY', progress: 20 },
  { id: '4', title: 'Aprobación de Baseline', start: 8, duration: 1, type: 'PMI_TASK', progress: 0, isMilestone: true },
  { id: '5', title: 'Migrar frontend a React', start: 8, duration: 6, type: 'AGILE_STORY', progress: 0 },
];

export default function GanttTimeline() {
  // Generar días para el encabezado (simplificado a 14 días)
  const days = Array.from({ length: 14 }, (_, i) => i + 1);

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-slate-900/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Cronograma (Gantt)</h1>
          <p className="mt-1 text-xs text-slate-400">Ruta crítica y dependencias del proyecto</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-md bg-slate-800 p-1">
            <button className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-sm font-medium text-slate-200 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Abril 2026
            </span>
            <button className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button className="flex items-center gap-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors border border-slate-700">
            <Filter className="h-4 w-4" />
            Filtros
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 shadow-sm min-w-[800px]">
          {/* Header del Gantt */}
          <div className="flex border-b border-slate-800">
            <div className="w-64 shrink-0 border-r border-slate-800 p-4 font-medium text-slate-300 text-sm flex items-center bg-slate-900 rounded-tl-xl">
              Nombre de la Tarea
            </div>
            <div className="flex flex-1 bg-slate-950/50 rounded-tr-xl">
              {days.map((day) => (
                <div key={day} className="flex-1 border-r border-slate-800/50 p-2 text-center text-xs font-medium text-slate-500">
                  Día {day}
                </div>
              ))}
            </div>
          </div>

          {/* Filas de Tareas */}
          <div className="divide-y divide-slate-800/50">
            {mockTasks.map((task) => (
              <div key={task.id} className="flex group hover:bg-slate-800/30 transition-colors">
                <div className="w-64 shrink-0 border-r border-slate-800 p-4 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${task.type === 'PMI_TASK' ? 'bg-emerald-500' : 'bg-indigo-500'}`} />
                  <span className="text-sm text-slate-300 truncate font-medium group-hover:text-white transition-colors">{task.title}</span>
                </div>
                
                <div className="relative flex flex-1 p-2">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {days.map((day) => (
                      <div key={day} className="flex-1 border-r border-slate-800/30" />
                    ))}
                  </div>
                  
                  {/* Barra de Tarea */}
                  {task.isMilestone ? (
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rotate-45 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.4)] z-10"
                      style={{ 
                        left: `calc(${(task.start - 1) * (100 / days.length)}% - 8px)`
                      }}
                      title={task.title}
                    />
                  ) : (
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 h-6 rounded-md shadow-sm z-10 overflow-hidden flex"
                      style={{ 
                        left: `${(task.start - 1) * (100 / days.length)}%`,
                        width: `calc(${task.duration * (100 / days.length)}% - 4px)`
                      }}
                    >
                      {/* Fondo base */}
                      <div className={`absolute inset-0 ${task.type === 'PMI_TASK' ? 'bg-emerald-900/40 border border-emerald-500/50' : 'bg-indigo-900/40 border border-indigo-500/50'} rounded-md`} />
                      
                      {/* Progreso */}
                      <div 
                        className={`h-full ${task.type === 'PMI_TASK' ? 'bg-emerald-500' : 'bg-indigo-500'} transition-all`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
