import { FileText, Plus, Search, MoreVertical, Bold, Italic, Link as LinkIcon, List, Image as ImageIcon, MessageSquare, Video, Mail } from 'lucide-react';

export default function DocsPage() {
  return (
    <div className="flex h-full bg-background overflow-hidden">
      
      {/* Docs Sidebar */}
      <div className="w-72 flex-shrink-0 border-r border-border bg-subtle/50 flex flex-col">
        <div className="p-4 border-b border-border flex justify-between items-center">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-400" />
            Docs & Wiki
          </h2>
          <button className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-white transition-colors">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Buscar en docs..." 
              className="w-full rounded bg-background border border-border py-1.5 pl-8 pr-3 text-xs text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* Doc Item */}
          <div className="flex items-center justify-between p-2 rounded bg-indigo-500/10 text-indigo-400 cursor-pointer border border-indigo-500/20">
            <div className="flex items-center gap-2 overflow-hidden">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="text-sm truncate">Arquitectura AWS TO-BE</span>
            </div>
            <MoreVertical className="h-4 w-4 shrink-0 opacity-50 hover:opacity-100" />
          </div>

          <div className="flex items-center justify-between p-2 rounded text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer transition-colors">
            <div className="flex items-center gap-2 overflow-hidden">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="text-sm truncate">Políticas de Seguridad ITIL</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-2 rounded text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer transition-colors">
            <div className="flex items-center gap-2 overflow-hidden">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="text-sm truncate">Manual de Onboarding</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col bg-background relative">
        {/* Editor Toolbar */}
        <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-card/40 shrink-0">
          <div className="flex items-center gap-1 bg-card p-1 rounded-md border border-border">
            <button className="p-1.5 rounded text-muted-foreground hover:text-white hover:bg-secondary transition-colors"><Bold className="h-4 w-4" /></button>
            <button className="p-1.5 rounded text-muted-foreground hover:text-white hover:bg-secondary transition-colors"><Italic className="h-4 w-4" /></button>
            <button className="p-1.5 rounded text-muted-foreground hover:text-white hover:bg-secondary transition-colors"><LinkIcon className="h-4 w-4" /></button>
            <div className="w-px h-4 bg-border mx-1" />
            <button className="p-1.5 rounded text-muted-foreground hover:text-white hover:bg-secondary transition-colors"><List className="h-4 w-4" /></button>
            <button className="p-1.5 rounded text-muted-foreground hover:text-white hover:bg-secondary transition-colors"><ImageIcon className="h-4 w-4" /></button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              <div className="h-7 w-7 rounded-full border-2 border-background bg-emerald-500 flex items-center justify-center text-[10px] font-bold text-white">AS</div>
              <div className="h-7 w-7 rounded-full border-2 border-background bg-indigo-500 flex items-center justify-center text-[10px] font-bold text-white">EM</div>
            </div>
            <span className="text-xs text-muted-foreground ml-2">Editando ahora...</span>
          </div>
        </div>

        {/* Document Content */}
        <div className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto py-12 px-8">
            <input 
              type="text" 
              className="text-4xl font-bold bg-transparent text-white border-none outline-none w-full mb-6"
              defaultValue="Arquitectura AWS TO-BE"
            />
            
            <div className="prose prose-invert prose-slate max-w-none">
              <p className="text-foreground/90 leading-relaxed text-lg mb-6">
                Este documento define la infraestructura objetivo para Inversiones Avante utilizando un enfoque de alta disponibilidad en AWS.
              </p>
              
              <h3 className="text-xl font-semibold text-foreground mt-8 mb-4">1. Componentes Core</h3>
              <ul className="list-disc pl-5 text-foreground/90 space-y-2 mb-6">
                <li><strong>VPC y Networking:</strong> Subnets públicas y privadas en 2 AZs.</li>
                <li><strong>Computo:</strong> Cluster EKS para orquestación de contenedores.</li>
                <li><strong>Base de Datos:</strong> RDS PostgreSQL en Multi-AZ (Supabase integrado).</li>
              </ul>

              <div className="bg-card border border-border rounded-lg p-4 my-6 text-sm text-muted-foreground font-mono">
                $ terraform apply -var-file=&quot;prod.tfvars&quot;
              </div>
            </div>
            
            {/* Inline Collaboration Tools Demo */}
            <div className="mt-12 pt-8 border-t border-border/50 flex gap-4">
               <button className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2 text-sm text-foreground/90 hover:bg-secondary transition-colors">
                 <MessageSquare className="h-4 w-4 text-indigo-400" /> Añadir Comentario
               </button>
               <button className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2 text-sm text-foreground/90 hover:bg-secondary transition-colors">
                 <Video className="h-4 w-4 text-emerald-400" /> Grabar Clip de Pantalla
               </button>
               <button className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2 text-sm text-foreground/90 hover:bg-secondary transition-colors">
                 <Mail className="h-4 w-4 text-amber-400" /> Enviar por Email
               </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
