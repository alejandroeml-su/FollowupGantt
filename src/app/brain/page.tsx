'use client';

import { useState } from 'react';
import { Sparkles, PenTool, BrainCircuit, Search, ArrowRight, Bot, Zap, Database } from 'lucide-react';

export default function BrainAIPage() {
  const [activeTab, setActiveTab] = useState('knowledge');

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-[#1e1b4b]/30">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            Avante Brain AI
          </h1>
          <p className="mt-1 text-xs text-slate-400">Inteligencia Artificial integrada en todo tu entorno de trabajo</p>
        </div>
        <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
          <button 
            onClick={() => setActiveTab('knowledge')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'knowledge' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            Knowledge Manager
          </button>
          <button 
            onClick={() => setActiveTab('pm')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'pm' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            Project Manager AI
          </button>
          <button 
            onClick={() => setActiveTab('writer')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'writer' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            Writer AI
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8 relative">
        {/* Background ambient glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="mx-auto max-w-4xl relative z-10 h-full flex flex-col">
          
          {activeTab === 'knowledge' && (
            <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="text-center space-y-4">
                 <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.2)]">
                   <BrainCircuit className="h-10 w-10 text-indigo-400" />
                 </div>
                 <h2 className="text-3xl font-bold text-white">Pregúntale a Avante Brain</h2>
                 <p className="text-slate-400 max-w-lg text-sm">
                   El Knowledge Manager indexa todos los proyectos, documentos, wikis y tareas de la base de datos para responder cualquier consulta empresarial en lenguaje natural.
                 </p>
               </div>

               <div className="w-full max-w-2xl relative">
                 <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-indigo-400" />
                 <input 
                   type="text" 
                   placeholder="Ej: ¿Cuál es el SLA definido para tickets de hardware ITIL en la política del Release 1?"
                   className="w-full rounded-xl border border-indigo-500/30 bg-slate-900/80 py-4 pl-12 pr-14 text-sm text-white shadow-xl focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 backdrop-blur-sm transition-all"
                 />
                 <button className="absolute right-3 top-1/2 -translate-y-1/2 bg-indigo-500 hover:bg-indigo-400 text-white p-2 rounded-lg transition-colors">
                   <ArrowRight className="h-4 w-4" />
                 </button>
               </div>

               <div className="flex gap-4 mt-8">
                 <div className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 cursor-pointer hover:border-indigo-500/50 transition-colors">
                   Resumir riesgos del proyecto actual
                 </div>
                 <div className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 cursor-pointer hover:border-indigo-500/50 transition-colors">
                   Buscar requerimientos de la Fase 2
                 </div>
               </div>
            </div>
          )}

          {activeTab === 'pm' && (
            <div className="flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="flex items-center gap-4 mb-8">
                 <div className="h-12 w-12 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                   <Bot className="h-6 w-6 text-purple-400" />
                 </div>
                 <div>
                   <h2 className="text-2xl font-bold text-white">Project Manager AI</h2>
                   <p className="text-slate-400 text-sm">Resúmenes de estado y alertas de riesgo generadas automáticamente</p>
                 </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                   <div className="flex items-center gap-2 mb-4">
                     <Zap className="h-4 w-4 text-emerald-400" />
                     <h3 className="font-semibold text-slate-200">Stand-up Summary (Hoy)</h3>
                   </div>
                   <div className="space-y-4 text-sm text-slate-300">
                     <p>Basado en la actividad de Prisma de las últimas 24h:</p>
                     <ul className="list-disc pl-5 space-y-2 text-slate-400">
                       <li><strong className="text-slate-200">Edwin Martinez</strong> completó 1 tarea ("Configuración VPC") y tiene 1 en progreso ("Security Groups").</li>
                       <li>El proyecto <strong className="text-indigo-400">Infraestructura Cloud Avante</strong> avanzó un 15% global.</li>
                       <li>No hay cuellos de botella detectados para hoy.</li>
                     </ul>
                   </div>
                 </div>

                 <div className="bg-slate-900 border border-red-900/30 rounded-xl p-6 shadow-lg relative overflow-hidden">
                   <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 blur-3xl rounded-full" />
                   <div className="flex items-center gap-2 mb-4 relative z-10">
                     <Database className="h-4 w-4 text-red-400" />
                     <h3 className="font-semibold text-slate-200">Análisis de Riesgos (EVM)</h3>
                   </div>
                   <div className="space-y-4 text-sm text-slate-300 relative z-10">
                     <p>La IA ha detectado una desviación potencial en el cronograma:</p>
                     <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                       <p className="text-red-400 font-medium mb-1">Riesgo Alto: Retraso de 2 días proyectado</p>
                       <p className="text-xs text-slate-500">La tarea "Validación de Security Groups" lleva 24h en IN_PROGRESS y está en la ruta crítica del Gantt. Si no se cierra mañana, el SPI caerá a 0.94.</p>
                     </div>
                     <button className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-2 rounded-lg font-medium transition-colors">
                       Auto-Reasignar Recursos
                     </button>
                   </div>
                 </div>
               </div>
            </div>
          )}

          {activeTab === 'writer' && (
            <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="flex items-center gap-4 mb-8">
                 <div className="h-12 w-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                   <PenTool className="h-6 w-6 text-amber-400" />
                 </div>
                 <div>
                   <h2 className="text-2xl font-bold text-white">Writer AI</h2>
                   <p className="text-slate-400 text-sm">Asistente generativo para requerimientos, documentación y correos</p>
                 </div>
               </div>

               <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow-lg">
                 <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex gap-2">
                   <button className="px-3 py-1.5 bg-slate-800 rounded text-xs text-slate-300 border border-slate-700">Generar User Story</button>
                   <button className="px-3 py-1.5 bg-slate-800 rounded text-xs text-slate-300 border border-slate-700">Redactar Correo a Stakeholders</button>
                   <button className="px-3 py-1.5 bg-indigo-500/20 rounded text-xs text-indigo-400 border border-indigo-500/30">Mejorar descripción de tarea</button>
                 </div>
                 <div className="flex-1 p-6 relative">
                   <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-900/80 pointer-events-none" />
                   
                   <p className="text-sm text-slate-500 mb-2 font-mono">// Texto original proporcionado por el usuario:</p>
                   <p className="text-slate-300 bg-slate-950 p-3 rounded-lg border border-slate-800 mb-6">
                     "Hacer la integracion con supabase para que se guarden las tareas y se vean en la lista"
                   </p>

                   <div className="flex items-center gap-2 mb-2 text-indigo-400 text-sm font-semibold">
                     <Sparkles className="h-4 w-4" /> Sugerencia de Writer AI:
                   </div>
                   <div className="prose prose-invert prose-sm">
                     <p className="bg-indigo-500/10 p-4 rounded-lg border border-indigo-500/20 text-slate-200">
                       <strong>Título:</strong> Integración de ORM Prisma y Supabase para Persistencia de Tareas<br/><br/>
                       <strong>Descripción:</strong> Como Desarrollador Backend, quiero conectar el módulo de "List View" con la base de datos PostgreSQL alojada en Supabase utilizando Prisma, para asegurar que todas las tareas se guarden y recuperen de manera persistente.<br/><br/>
                       <strong>Criterios de Aceptación:</strong><br/>
                       1. El cliente Prisma está inicializado en <code>src/lib/prisma.ts</code>.<br/>
                       2. El Server Component recupera datos usando <code>prisma.task.findMany()</code>.<br/>
                       3. Las mutaciones soportan SSR (Server-Side Rendering).
                     </p>
                   </div>
                 </div>
                 <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-end gap-3">
                   <button className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white transition-colors">Descartar</button>
                   <button className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20">
                     Aplicar a la Tarea
                   </button>
                 </div>
               </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
