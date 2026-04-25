'use client';

import { useState } from 'react';
import { Sparkles, PenTool, Bot, Zap, Database } from 'lucide-react';
import { KnowledgeChat } from '@/components/brain/KnowledgeChat';

export default function BrainAIPage() {
  const [activeTab, setActiveTab] = useState('knowledge');

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-[#1e1b4b]/30">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            Avante Brain AI
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Inteligencia Artificial integrada en todo tu entorno de trabajo</p>
        </div>
        <div className="flex bg-card rounded-lg p-1 border border-border">
          <button 
            onClick={() => setActiveTab('knowledge')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'knowledge' ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:text-white'}`}
          >
            Knowledge Manager
          </button>
          <button 
            onClick={() => setActiveTab('pm')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'pm' ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:text-white'}`}
          >
            Project Manager AI
          </button>
          <button 
            onClick={() => setActiveTab('writer')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'writer' ? 'bg-indigo-500 text-white' : 'text-muted-foreground hover:text-white'}`}
          >
            Writer AI
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8 relative">
        {/* Background ambient glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="mx-auto max-w-4xl relative z-10 h-full flex flex-col">
          
          {activeTab === 'knowledge' && <KnowledgeChat />}

          {activeTab === 'pm' && (
            <div className="flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="flex items-center gap-4 mb-8">
                 <div className="h-12 w-12 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                   <Bot className="h-6 w-6 text-purple-400" />
                 </div>
                 <div>
                   <h2 className="text-2xl font-bold text-white">Project Manager AI</h2>
                   <p className="text-muted-foreground text-sm">Resúmenes de estado y alertas de riesgo generadas automáticamente</p>
                 </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="bg-card border border-border rounded-xl p-6 shadow-lg">
                   <div className="flex items-center gap-2 mb-4">
                     <Zap className="h-4 w-4 text-emerald-400" />
                     <h3 className="font-semibold text-foreground">Stand-up Summary (Hoy)</h3>
                   </div>
                   <div className="space-y-4 text-sm text-foreground/90">
                     <p>Basado en la actividad de Prisma de las últimas 24h:</p>
                     <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                       <li><strong className="text-foreground">Edwin Martinez</strong> completó 1 tarea (&quot;Configuración VPC&quot;) y tiene 1 en progreso (&quot;Security Groups&quot;).</li>
                       <li>El proyecto <strong className="text-indigo-400">Infraestructura Cloud Avante</strong> avanzó un 15% global.</li>
                       <li>No hay cuellos de botella detectados para hoy.</li>
                     </ul>
                   </div>
                 </div>

                 <div className="bg-card border border-red-900/30 rounded-xl p-6 shadow-lg relative overflow-hidden">
                   <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 blur-3xl rounded-full" />
                   <div className="flex items-center gap-2 mb-4 relative z-10">
                     <Database className="h-4 w-4 text-red-400" />
                     <h3 className="font-semibold text-foreground">Análisis de Riesgos (EVM)</h3>
                   </div>
                   <div className="space-y-4 text-sm text-foreground/90 relative z-10">
                     <p>La IA ha detectado una desviación potencial en el cronograma:</p>
                     <div className="bg-background rounded-lg p-3 border border-border">
                       <p className="text-red-400 font-medium mb-1">Riesgo Alto: Retraso de 2 días proyectado</p>
                       <p className="text-xs text-muted-foreground">La tarea &quot;Validación de Security Groups&quot; lleva 24h en IN_PROGRESS y está en la ruta crítica del Gantt. Si no se cierra mañana, el SPI caerá a 0.94.</p>
                     </div>
                     <button className="w-full mt-2 bg-secondary hover:bg-secondary/80 text-foreground/90 text-xs py-2 rounded-lg font-medium transition-colors">
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
                   <p className="text-muted-foreground text-sm">Asistente generativo para requerimientos, documentación y correos</p>
                 </div>
               </div>

               <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden shadow-lg">
                 <div className="p-4 border-b border-border bg-background/95 flex gap-2">
                   <button className="px-3 py-1.5 bg-secondary rounded text-xs text-foreground/90 border border-border">Generar User Story</button>
                   <button className="px-3 py-1.5 bg-secondary rounded text-xs text-foreground/90 border border-border">Redactar Correo a Stakeholders</button>
                   <button className="px-3 py-1.5 bg-indigo-500/20 rounded text-xs text-indigo-400 border border-indigo-500/30">Mejorar descripción de tarea</button>
                 </div>
                 <div className="flex-1 p-6 relative">
                   <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card/80 pointer-events-none" />
                   
                   <p className="text-sm text-muted-foreground mb-2 font-mono">{'// Texto original proporcionado por el usuario:'}</p>
                   <p className="text-foreground/90 bg-background p-3 rounded-lg border border-border mb-6">
                     &quot;Hacer la integracion con supabase para que se guarden las tareas y se vean en la lista&quot;
                   </p>

                   <div className="flex items-center gap-2 mb-2 text-indigo-400 text-sm font-semibold">
                     <Sparkles className="h-4 w-4" /> Sugerencia de Writer AI:
                   </div>
                   <div className="prose prose-invert prose-sm">
                     <p className="bg-indigo-500/10 p-4 rounded-lg border border-indigo-500/20 text-foreground">
                       <strong>Título:</strong> Integración de ORM Prisma y Supabase para Persistencia de Tareas<br/><br/>
                       <strong>Descripción:</strong> Como Desarrollador Backend, quiero conectar el módulo de &quot;List View&quot; con la base de datos PostgreSQL alojada en Supabase utilizando Prisma, para asegurar que todas las tareas se guarden y recuperen de manera persistente.<br/><br/>
                       <strong>Criterios de Aceptación:</strong><br/>
                       1. El cliente Prisma está inicializado en <code>src/lib/prisma.ts</code>.<br/>
                       2. El Server Component recupera datos usando <code>prisma.task.findMany()</code>.<br/>
                       3. Las mutaciones soportan SSR (Server-Side Rendering).
                     </p>
                   </div>
                 </div>
                 <div className="p-4 border-t border-border bg-background/95 flex justify-end gap-3">
                   <button className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-white transition-colors">Descartar</button>
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
