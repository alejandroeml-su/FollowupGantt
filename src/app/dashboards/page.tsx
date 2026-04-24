import { LayoutTemplate, TrendingDown, TrendingUp, AlertTriangle, Activity, Database, GitCompare } from 'lucide-react';
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardsPage() {
  const projects = await prisma.project.findMany({
    include: { tasks: true }
  });

  // Cálculos EVM Mock (Normalmente provendrían de formulas sobre las tasks)
  const cpi = 0.92; // Cost Performance Index (Under 1 is bad)
  const spi = 1.05; // Schedule Performance Index (Over 1 is good)

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-slate-900/50">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5 text-indigo-400" />
            Dashboards Ejecutivos & Gobernanza
          </h1>
          <p className="mt-1 text-xs text-slate-400">EVM, Análisis de Brechas (Gap) y Matriz de Riesgos</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          
          {/* Fila 1: EVM Widgets */}
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4" /> Earned Value Management (EVM)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <p className="text-xs text-slate-500 font-medium mb-1">Schedule Performance (SPI)</p>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-bold text-white">{spi}</span>
                <span className="flex items-center text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">
                  <TrendingUp className="h-3 w-3 mr-1" /> Adelantado
                </span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <p className="text-xs text-slate-500 font-medium mb-1">Cost Performance (CPI)</p>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-bold text-white">{cpi}</span>
                <span className="flex items-center text-xs font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
                  <TrendingDown className="h-3 w-3 mr-1" /> Sobre costo
                </span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
              <p className="text-xs text-slate-500 font-medium mb-1">Planned Value (PV)</p>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-bold text-slate-200">$45,000</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm border-b-2 border-b-indigo-500">
              <p className="text-xs text-slate-500 font-medium mb-1">Earned Value (EV)</p>
              <div className="flex items-end justify-between">
                <span className="text-3xl font-bold text-indigo-400">$47,250</span>
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            
            {/* Matriz de Riesgos */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col shadow-sm">
              <div className="p-5 border-b border-slate-800 flex justify-between items-center">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                  Matriz de Riesgos (Impacto vs Probabilidad)
                </h3>
              </div>
              <div className="p-6 flex-1 flex items-center justify-center">
                 <div className="grid grid-cols-3 grid-rows-3 gap-1 w-full max-w-sm aspect-square">
                    {/* Fila Alta Prob */}
                    <div className="bg-amber-500/20 border border-amber-500/30 flex items-center justify-center rounded-tl-lg text-amber-400 font-bold">1</div>
                    <div className="bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 font-bold">4</div>
                    <div className="bg-red-600/30 border border-red-500/50 flex items-center justify-center rounded-tr-lg text-red-400 font-bold text-2xl">2</div>
                    
                    {/* Fila Med Prob */}
                    <div className="bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">0</div>
                    <div className="bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xl">3</div>
                    <div className="bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 font-bold">1</div>
                    
                    {/* Fila Baja Prob */}
                    <div className="bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center rounded-bl-lg text-emerald-600 font-bold">0</div>
                    <div className="bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">0</div>
                    <div className="bg-amber-500/20 border border-amber-500/30 flex items-center justify-center rounded-br-lg text-amber-400 font-bold">0</div>
                 </div>
              </div>
            </div>

            {/* Gap Analysis AS-IS vs TO-BE */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl flex flex-col shadow-sm">
              <div className="p-5 border-b border-slate-800 flex justify-between items-center">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <GitCompare className="h-4 w-4 text-blue-400" />
                  Gap Analysis (TI)
                </h3>
              </div>
              <div className="p-6 flex-1 space-y-6">
                 
                 <div>
                   <div className="flex justify-between text-sm mb-2">
                     <span className="text-slate-400">Infraestructura On-Premise (AS-IS)</span>
                     <span className="text-indigo-400 font-medium">AWS Cloud (TO-BE)</span>
                   </div>
                   <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden relative flex">
                      <div className="w-1/3 bg-slate-600 h-full border-r border-slate-900" />
                      <div className="w-1/3 bg-indigo-500 h-full relative overflow-hidden">
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      </div>
                   </div>
                   <p className="text-[10px] text-slate-500 mt-2 text-center uppercase tracking-widest">Migración 66% Completada</p>
                 </div>

                 <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                   <h4 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
                     <Database className="h-4 w-4 text-emerald-400" /> CMDB Health
                   </h4>
                   <ul className="space-y-2 text-xs text-slate-400">
                     <li className="flex justify-between border-b border-slate-800/50 pb-1">
                       <span>Servidores Mapeados:</span> <span className="text-slate-200">142 / 150</span>
                     </li>
                     <li className="flex justify-between border-b border-slate-800/50 pb-1">
                       <span>Incidentes Críticos:</span> <span className="text-red-400">2</span>
                     </li>
                     <li className="flex justify-between pb-1">
                       <span>SLA Cumplimiento:</span> <span className="text-emerald-400">98.5%</span>
                     </li>
                   </ul>
                 </div>

              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
