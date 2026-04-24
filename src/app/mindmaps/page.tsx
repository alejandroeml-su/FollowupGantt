import { Network, ZoomIn, ZoomOut, Share2 } from 'lucide-react';
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function MindMapsPage() {
  const projects = await prisma.project.findMany({
    include: {
      tasks: {
        where: { parentId: null },
        include: { subtasks: true }
      }
    }
  });

  return (
    <div className="flex h-full flex-col bg-slate-950 overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-slate-900/50 z-10">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Network className="h-5 w-5 text-indigo-400" />
            Mind Maps (Supabase SSR)
          </h1>
          <p className="mt-1 text-xs text-slate-400">Estructura lógica y desglose de trabajo jerárquico</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-md bg-slate-800 p-1 border border-slate-700">
            <button className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors">
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="px-2 text-xs font-medium text-slate-400">100%</span>
            <button className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-700 transition-colors">
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
          <button className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors">
            <Share2 className="h-4 w-4" />
            Compartir
          </button>
        </div>
      </header>

      {/* Infinite Canvas Simulation */}
      <div className="flex-1 relative bg-[#0B1120] overflow-auto">
        <div className="absolute inset-0" style={{ 
          backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)', 
          backgroundSize: '24px 24px' 
        }}></div>
        
        <div className="relative min-h-[800px] min-w-[1200px] p-20 flex justify-center items-center">
          {projects.length === 0 ? (
            <div className="text-slate-500 bg-slate-900 p-4 rounded-xl border border-slate-800">
              No hay proyectos en la Base de Datos para mapear.
            </div>
          ) : (
            <div className="flex flex-col items-center gap-12">
              {projects.map(project => (
                <div key={project.id} className="flex flex-col items-center">
                  
                  {/* Nodo Raíz (Proyecto) */}
                  <div className="bg-indigo-500/10 border-2 border-indigo-500 rounded-2xl p-6 w-64 text-center shadow-[0_0_30px_rgba(99,102,241,0.2)] z-10 backdrop-blur-sm">
                    <h2 className="text-lg font-bold text-white mb-1">{project.name}</h2>
                    <p className="text-xs text-indigo-300">Proyecto Raíz</p>
                  </div>
                  
                  {/* Línea conectora raíz */}
                  {project.tasks.length > 0 && (
                    <div className="w-0.5 h-12 bg-slate-700" />
                  )}

                  {/* Nivel Tareas */}
                  <div className="flex gap-8 relative">
                    {/* Línea horizontal conectora */}
                    {project.tasks.length > 1 && (
                      <div className="absolute top-0 left-[50%] right-[50%] h-0.5 bg-slate-700" 
                           style={{ width: `calc(100% - ${100 / project.tasks.length}%)`, transform: 'translateX(-50%)' }} />
                    )}
                    
                    {project.tasks.map(task => (
                      <div key={task.id} className="flex flex-col items-center relative">
                        {/* Línea vertical conectora (si hay multiples) */}
                        {project.tasks.length > 1 && <div className="w-0.5 h-8 bg-slate-700" />}
                        
                        {/* Nodo Tarea */}
                        <div className="bg-slate-800 border border-slate-600 rounded-xl p-4 w-48 text-center shadow-lg z-10 hover:border-indigo-400 transition-colors cursor-pointer">
                          <p className="text-sm font-semibold text-slate-200 truncate">{task.title}</p>
                          <span className="inline-block mt-2 px-2 py-0.5 bg-slate-900 rounded text-[10px] text-slate-400">
                            {task.status}
                          </span>
                        </div>

                        {/* Línea conectora subtareas */}
                        {task.subtasks.length > 0 && (
                          <div className="w-0.5 h-8 bg-slate-700" />
                        )}

                        {/* Nivel Subtareas */}
                        <div className="flex flex-col gap-4">
                          {task.subtasks.map(sub => (
                            <div key={sub.id} className="flex items-center relative">
                               <div className="w-4 h-0.5 bg-slate-700 absolute -left-4" />
                               <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 w-40 text-center shadow-md hover:border-slate-500 transition-colors cursor-pointer">
                                  <p className="text-xs font-medium text-slate-300 truncate">{sub.title}</p>
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
  );
}
