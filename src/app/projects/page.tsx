import { FolderKanban, Plus, Layers, Target, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

const mockAreas = [
  {
    id: "1",
    name: "Gerencia de TI",
    projects: [
      {
        id: "p1",
        name: "Migración a la Nube (AWS)",
        status: "ACTIVE",
        manager: "Edwin Martinez",
        cpi: 0.95,
        spi: 1.05,
        phases: 4,
        tasks: 24,
        progress: 65,
      },
      {
        id: "p2",
        name: "Implementación ERP Dynamics",
        status: "PLANNING",
        manager: "Ana Lopez",
        cpi: 1.0,
        spi: 1.0,
        phases: 5,
        tasks: 0,
        progress: 0,
      }
    ]
  },
  {
    id: "2",
    name: "Operaciones y Logística",
    projects: [
      {
        id: "p3",
        name: "Automatización de Centro de Distribución",
        status: "ON_HOLD",
        manager: "Carlos Ruiz",
        cpi: 0.82,
        spi: 0.75,
        phases: 3,
        tasks: 12,
        progress: 30,
      }
    ]
  }
];

export default function ProjectsMaintenance() {
  return (
    <div className="flex h-full flex-col bg-slate-950 overflow-y-auto p-8">
      <header className="mb-8 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <FolderKanban className="h-8 w-8 text-indigo-500" />
            Portafolio de Proyectos
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Mantenimiento y planificación de proyectos por Gerencia, Fases y Tareas. (EVM: CPI/SPI)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors border border-slate-700">
            Nueva Área
          </button>
          <button className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/20">
            <Plus className="h-4 w-4" />
            Crear Proyecto
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto w-full space-y-10">
        {mockAreas.map((area) => (
          <div key={area.id} className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-200 border-b border-slate-800 pb-2 flex items-center gap-2">
              <Layers className="h-5 w-5 text-slate-500" />
              {area.name}
            </h2>
            
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {area.projects.map((project) => (
                <div key={project.id} className="group rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-sm hover:border-indigo-500/50 transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-medium text-white group-hover:text-indigo-400 transition-colors">{project.name}</h3>
                      <p className="text-xs text-slate-500 mt-1">PM: {project.manager}</p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                      project.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 
                      project.status === 'PLANNING' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 
                      'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {project.status}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-6">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-400">Progreso General</span>
                      <span className="text-slate-200 font-medium">{project.progress}%</span>
                    </div>
                    <div className="w-full bg-slate-950 rounded-full h-2 border border-slate-800/50">
                      <div 
                        className="bg-indigo-500 h-2 rounded-full transition-all duration-500" 
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </div>

                  {/* EVM & Structure Metrics */}
                  <div className="grid grid-cols-4 gap-4 bg-slate-950/50 rounded-lg p-4 border border-slate-800/50">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Fases</span>
                      <span className="text-sm font-medium text-slate-300">{project.phases}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Tareas</span>
                      <span className="text-sm font-medium text-slate-300">{project.tasks}</span>
                    </div>
                    <div className="flex flex-col border-l border-slate-800 pl-4">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1" title="Schedule Performance Index">SPI</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-bold ${project.spi >= 1.0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {project.spi.toFixed(2)}
                        </span>
                        {project.spi >= 1.0 ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-red-500" />}
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1" title="Cost Performance Index">CPI</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-bold ${project.cpi >= 1.0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {project.cpi.toFixed(2)}
                        </span>
                        {project.cpi >= 1.0 ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-amber-500" />}
                      </div>
                    </div>
                  </div>
                  
                  {/* Footer actions */}
                  <div className="mt-5 flex gap-3">
                    <button className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors">Ver Fases y Tareas</button>
                    <button className="text-xs font-medium text-slate-400 hover:text-slate-300 transition-colors">Línea Base</button>
                    <button className="text-xs font-medium text-slate-400 hover:text-slate-300 transition-colors">Configurar EVM</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
