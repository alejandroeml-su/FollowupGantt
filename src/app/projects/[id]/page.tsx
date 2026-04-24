'use client';

import { useState } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, Plus, Calendar as CalendarIcon, Link as LinkIcon, 
  GitCommit, ChevronRight, ChevronDown, CheckCircle2, ListTree, SlidersHorizontal, Settings, X
} from 'lucide-react';

// Datos Mock con jerarquía
const initialTasks = [
  {
    id: "t1", title: "Fase 1: Levantamiento", type: "PHASE", start: "2026-05-01", end: "2026-05-15", progress: 100,
    subtasks: [
      { id: "t1-1", title: "Reunión Kickoff", type: "PMI_TASK", start: "2026-05-01", end: "2026-05-02", progress: 100 },
      { id: "t1-2", title: "Toma de requerimientos", type: "AGILE_STORY", start: "2026-05-03", end: "2026-05-15", progress: 100 }
    ]
  },
  {
    id: "t2", title: "Fase 2: Arquitectura y Diseño", type: "PHASE", start: "2026-05-16", end: "2026-06-10", progress: 40,
    subtasks: [
      { id: "t2-1", title: "Diseño de Base de Datos", type: "PMI_TASK", start: "2026-05-16", end: "2026-05-20", progress: 100 },
      { 
        id: "t2-2", title: "Diseño de Interfaces (UI)", type: "PMI_TASK", start: "2026-05-21", end: "2026-06-10", progress: 10,
        subtasks: [
          { id: "t2-2-1", title: "Wireframes Dashboard", type: "AGILE_STORY", start: "2026-05-21", end: "2026-05-25", progress: 50 },
          { id: "t2-2-2", title: "UI Components Kanban", type: "AGILE_STORY", start: "2026-05-26", end: "2026-06-10", progress: 0 }
        ]
      }
    ]
  }
];

const mockDependencies = [
  { id: "d1", from: "t1-1", to: "t1-2", type: "FS" },
  { id: "d2", from: "t1-2", to: "t2-1", type: "FS" },
  { id: "d3", from: "t2-1", to: "t2-2", type: "FS" },
];

export default function ProjectDetailManagement({ params }: { params: { id: string } }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [dependencies, setDependencies] = useState(mockDependencies);
  
  const [activeTab, setActiveTab] = useState<'WBS' | 'DEPENDENCIES'>('WBS');
  
  // Modals state
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isDependencyModalOpen, setIsDependencyModalOpen] = useState(false);
  
  // Form states
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  interface MockTask { id: string; title: string; type: string; start: string; end: string; progress: number; subtasks?: MockTask[] }

  // Render Recursivo de Tareas (WBS)
  const renderTaskRow = (task: MockTask, level = 0) => {
    return (
      <div key={task.id} className="flex flex-col">
        <div className={`flex items-center group hover:bg-secondary/50 border-b border-border/50 py-3 px-4 transition-colors ${level === 0 ? 'bg-card/40' : ''}`}>
          <div className="flex-1 flex items-center gap-2" style={{ paddingLeft: `${level * 1.5}rem` }}>
            {task.subtasks && task.subtasks.length > 0 ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <GitCommit className="h-4 w-4 text-muted-foreground ml-1" />
            )}
            
            <span className={`font-medium ${level === 0 ? 'text-indigo-300 text-base' : 'text-foreground text-sm'}`}>
              {task.title}
            </span>
            
            <span className={`ml-3 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
              task.type === 'PHASE' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
              task.type === 'PMI_TASK' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
              'bg-blue-500/10 text-blue-400 border-blue-500/20'
            }`}>
              {task.type}
            </span>
          </div>
          
          <div className="w-32 text-sm text-muted-foreground flex items-center gap-2">
            <CalendarIcon className="h-3 w-3" /> {task.start}
          </div>
          <div className="w-32 text-sm text-muted-foreground flex items-center gap-2">
            <CalendarIcon className="h-3 w-3" /> {task.end}
          </div>
          
          <div className="w-32 flex items-center gap-2">
            <div className="w-full bg-secondary rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${task.progress}%` }} />
            </div>
            <span className="text-xs text-muted-foreground w-8">{task.progress}%</span>
          </div>

          <div className="w-24 text-right opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => { setSelectedParentId(task.id); setIsTaskModalOpen(true); }}
              className="text-xs text-indigo-400 hover:text-indigo-300 mr-2"
              title="Añadir Subtarea"
            >
              + Subtarea
            </button>
          </div>
        </div>
        
        {task.subtasks && task.subtasks.map((sub: MockTask) => renderTaskRow(sub, level + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden relative">
      <header className="flex-shrink-0 bg-card border-b border-border px-8 py-5">
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
          <Link href="/projects" className="hover:text-indigo-400 transition-colors flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Volver a Proyectos
          </Link>
          <span>/</span>
          <span>Migración a la Nube (AWS)</span>
        </div>
        
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              Planificación Detallada (WBS & Dependencias)
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Mantenimiento de Fases, Tareas, Subtareas y Enlaces Críticos.
            </p>
          </div>
          
          <div className="flex gap-2">
            <button 
              onClick={() => { setSelectedParentId(null); setIsTaskModalOpen(true); }}
              className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20"
            >
              <Plus className="h-4 w-4" /> Crear Fase / Tarea
            </button>
            <button className="flex items-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm font-medium text-foreground/90 hover:bg-secondary/80 border border-border">
              <Settings className="h-4 w-4" /> Línea Base
            </button>
          </div>
        </div>

        {/* TABS */}
        <div className="flex gap-6 mt-6 border-b border-border">
          <button 
            onClick={() => setActiveTab('WBS')}
            className={`pb-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'WBS' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <ListTree className="h-4 w-4" /> Estructura de Tareas (WBS)
          </button>
          <button 
            onClick={() => setActiveTab('DEPENDENCIES')}
            className={`pb-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${activeTab === 'DEPENDENCIES' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            <LinkIcon className="h-4 w-4" /> Vincular Dependencias
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        {activeTab === 'WBS' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="flex items-center bg-background/95 border-b border-border py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <div className="flex-1">Estructura / Nombre</div>
              <div className="w-32">Fecha Inicio</div>
              <div className="w-32">Fecha Fin</div>
              <div className="w-32">Progreso</div>
              <div className="w-24 text-right">Acciones</div>
            </div>
            <div className="divide-y divide-border/50">
              {tasks.map(task => renderTaskRow(task, 0))}
            </div>
          </div>
        )}

        {activeTab === 'DEPENDENCIES' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 bg-card border border-border rounded-xl p-6 shadow-sm h-fit">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <LinkIcon className="h-5 w-5 text-indigo-400" /> Crear Vínculo
              </h3>
              <p className="text-sm text-muted-foreground mb-6">Visualmente vincula una tarea predecesora con su sucesora para generar la ruta crítica en el Gantt.</p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-foreground/90 mb-1 uppercase tracking-wider">Tarea Predecesora (A)</label>
                  <select className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                    <option>t1-1: Reunión Kickoff</option>
                    <option>t1-2: Toma de requerimientos</option>
                    <option>t2-1: Diseño de Base de Datos</option>
                  </select>
                </div>
                
                <div className="flex justify-center my-2">
                  <div className="h-8 w-px bg-border relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-secondary rounded-full p-1 border border-border">
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground/90 mb-1 uppercase tracking-wider">Tarea Sucesora (B)</label>
                  <select className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                    <option>t1-2: Toma de requerimientos</option>
                    <option>t2-1: Diseño de Base de Datos</option>
                    <option>t2-2-1: Wireframes Dashboard</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground/90 mb-1 uppercase tracking-wider mt-4">Tipo de Relación</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="bg-indigo-500/20 border border-indigo-500/50 text-indigo-300 text-xs py-2 rounded-md font-medium">Fin a Inicio (FS)</button>
                    <button className="bg-secondary border border-border text-muted-foreground hover:text-foreground/90 text-xs py-2 rounded-md font-medium transition-colors">Inicio a Inicio (SS)</button>
                    <button className="bg-secondary border border-border text-muted-foreground hover:text-foreground/90 text-xs py-2 rounded-md font-medium transition-colors">Fin a Fin (FF)</button>
                    <button className="bg-secondary border border-border text-muted-foreground hover:text-foreground/90 text-xs py-2 rounded-md font-medium transition-colors">Inicio a Fin (SF)</button>
                  </div>
                </div>

                <button className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-colors mt-4">
                  Guardar Dependencia
                </button>
              </div>
            </div>

            <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center bg-background/95 border-b border-border py-4 px-6">
                <h3 className="font-semibold text-foreground">Enlaces Activos</h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {dependencies.map(dep => (
                    <div key={dep.id} className="flex items-center justify-between p-4 rounded-lg bg-background border border-border">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="px-3 py-2 bg-card rounded border border-border text-sm text-foreground/90 w-1/3 truncate">
                          {dep.from}
                        </div>
                        <div className="flex flex-col items-center justify-center shrink-0 w-24">
                          <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded uppercase">{dep.type}</span>
                          <div className="w-full h-px bg-border relative mt-1">
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 border-t border-r border-slate-500 rotate-45"></div>
                          </div>
                        </div>
                        <div className="px-3 py-2 bg-card rounded border border-border text-sm text-foreground/90 w-1/3 truncate">
                          {dep.to}
                        </div>
                      </div>
                      <button className="ml-4 text-muted-foreground hover:text-red-400 transition-colors">
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL MANTENIMIENTO TAREA/SUBTAREA */}
      {isTaskModalOpen && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <GitCommit className="h-5 w-5 text-indigo-400" />
                {selectedParentId ? 'Crear Subtarea' : 'Crear Nueva Fase / Tarea Raíz'}
              </h3>
              <button onClick={() => setIsTaskModalOpen(false)} className="text-muted-foreground hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground/90 mb-1">Título de la Tarea</label>
                <input type="text" className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500" placeholder="Ej. Diseño de Arquitectura" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/90 mb-1">Tipo de Tarea</label>
                  <select className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground/90 focus:outline-none focus:border-indigo-500">
                    <option>PHASE (Agrupador PMI)</option>
                    <option>PMI_TASK (Tarea Clásica)</option>
                    <option>AGILE_STORY (Historia de Usuario)</option>
                    <option>ITIL_TICKET (Incidencia/Requerimiento)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/90 mb-1">Responsable</label>
                  <select className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground/90 focus:outline-none focus:border-indigo-500">
                    <option>Sin Asignar</option>
                    <option>Edwin Martinez</option>
                    <option>Desarrollador 1</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-background/95 p-4 rounded-lg border border-border">
                <div>
                  <label className="block text-sm font-medium text-foreground/90 mb-1 flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" /> Fecha Inicio
                  </label>
                  <input type="date" className="w-full bg-card border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500 color-scheme-dark" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/90 mb-1 flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" /> Fecha Fin
                  </label>
                  <input type="date" className="w-full bg-card border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500 color-scheme-dark" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground/90 mb-1">Descripción</label>
                <textarea className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500" rows={3} placeholder="Criterios de aceptación o descripción..." />
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <button onClick={() => setIsTaskModalOpen(false)} className="px-5 py-2.5 rounded-lg text-sm font-medium text-foreground/90 hover:bg-secondary transition-colors">
                  Cancelar
                </button>
                <button className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-lg transition-colors shadow-lg shadow-indigo-500/20">
                  Guardar Tarea
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
