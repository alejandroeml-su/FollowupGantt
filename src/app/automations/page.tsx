import { Zap, Plus, ArrowRight, Play, CheckCircle2, MoreVertical, Search, GitMerge } from 'lucide-react';

export default function AutomationsPage() {
  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-slate-900/50">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Zap className="h-5 w-5 text-indigo-400" />
            Automatizaciones
          </h1>
          <p className="mt-1 text-xs text-slate-400">Reglas lógicas para reducir trabajo operativo manual (Si X, entonces Y)</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors">
            <Plus className="h-4 w-4" />
            Añadir Automatización
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-5xl">
          
          <div className="flex items-center justify-between mb-6">
            <div className="flex gap-4 border-b border-slate-800 w-full">
              <button className="pb-2 border-b-2 border-indigo-500 text-indigo-400 font-medium text-sm px-2">
                Activas (4)
              </button>
              <button className="pb-2 border-b-2 border-transparent text-slate-500 hover:text-slate-300 font-medium text-sm px-2 transition-colors">
                Plantillas
              </button>
              <button className="pb-2 border-b-2 border-transparent text-slate-500 hover:text-slate-300 font-medium text-sm px-2 transition-colors">
                Historial de Ejecución
              </button>
            </div>
            
            <div className="relative shrink-0 ml-8">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Buscar reglas..." 
                className="w-64 rounded-md border border-slate-700 bg-slate-900 py-1.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-4">
            
            {/* Rule 1 */}
            <div className="group rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-slate-700 transition-colors shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="relative inline-flex h-8 w-14 items-center rounded-full bg-indigo-500 transition-colors cursor-pointer">
                    <span className="inline-block h-6 w-6 translate-x-7 transform rounded-full bg-white transition-transform" />
                  </div>
                  <span className="text-sm font-medium text-slate-200">Asignación de Bug a QA</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Ejecutada 12 veces hoy
                  </span>
                  <button className="text-slate-500 hover:text-white"><MoreVertical className="h-4 w-4" /></button>
                </div>
              </div>

              <div className="flex items-center gap-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800/50">
                <div className="flex-1 flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-slate-800 flex items-center justify-center border border-slate-700 shrink-0">
                    <Play className="h-4 w-4 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">CUANDO</p>
                    <p className="text-sm text-slate-200 font-medium">El estado cambie a &quot;REVIEW&quot;</p>
                  </div>
                </div>
                
                <ArrowRight className="h-5 w-5 text-indigo-500/50 shrink-0" />
                
                <div className="flex-1 flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shrink-0">
                    <GitMerge className="h-4 w-4 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-xs text-indigo-400/70 mb-0.5">ENTONCES</p>
                    <p className="text-sm text-slate-200 font-medium flex items-center gap-2">
                      Cambiar Asignado a <span className="bg-slate-800 px-2 py-0.5 rounded text-xs text-slate-300">Equipo QA</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Rule 2 */}
            <div className="group rounded-xl border border-slate-800 bg-slate-900 p-5 hover:border-slate-700 transition-colors shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="relative inline-flex h-8 w-14 items-center rounded-full bg-indigo-500 transition-colors cursor-pointer">
                    <span className="inline-block h-6 w-6 translate-x-7 transform rounded-full bg-white transition-transform" />
                  </div>
                  <span className="text-sm font-medium text-slate-200">Alerta de Riesgo (EVM)</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Ejecutada 2 veces hoy
                  </span>
                  <button className="text-slate-500 hover:text-white"><MoreVertical className="h-4 w-4" /></button>
                </div>
              </div>

              <div className="flex items-center gap-4 bg-slate-950/50 p-4 rounded-lg border border-slate-800/50">
                <div className="flex-1 flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-slate-800 flex items-center justify-center border border-slate-700 shrink-0">
                    <Play className="h-4 w-4 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">CUANDO</p>
                    <p className="text-sm text-slate-200 font-medium">SPI del proyecto caiga por debajo de 0.85</p>
                  </div>
                </div>
                
                <ArrowRight className="h-5 w-5 text-amber-500/50 shrink-0" />
                
                <div className="flex-1 flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0">
                    <Zap className="h-4 w-4 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-amber-400/70 mb-0.5">ENTONCES</p>
                    <p className="text-sm text-slate-200 font-medium flex items-center gap-2">
                      Añadir comentario <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] uppercase font-bold">@ProjectManager ALERTA EVM</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
