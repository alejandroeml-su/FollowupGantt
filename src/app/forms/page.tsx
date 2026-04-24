import { ClipboardList, Plus, Settings, Share2, Eye, GripVertical } from 'lucide-react';

export default function FormsPage() {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-indigo-400" />
            Constructor de Formularios
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Captura externa de tickets y requerimientos</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-foreground/90 hover:bg-secondary/80 transition-colors border border-border">
            <Eye className="h-4 w-4" />
            Vista Previa
          </button>
          <button className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors">
            <Share2 className="h-4 w-4" />
            Publicar
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-4xl flex gap-8">
          
          {/* Form Editor Canvas */}
          <div className="flex-1 rounded-2xl bg-card border border-border shadow-xl overflow-hidden">
            <div className="h-2 bg-indigo-500" />
            <div className="p-8">
              <input 
                type="text" 
                className="w-full text-3xl font-bold bg-transparent text-white border-b border-transparent focus:border-border outline-none pb-2 mb-4"
                defaultValue="Solicitud de Soporte (ITIL)"
              />
              <textarea 
                className="w-full text-sm bg-transparent text-muted-foreground border-b border-transparent focus:border-border outline-none pb-2 mb-8 resize-none"
                placeholder="Descripción del formulario..."
                defaultValue="Por favor complete este formulario para generar un ticket automático en la cola de Service Desk."
              />

              <div className="space-y-4">
                {/* Form Field 1 */}
                <div className="group relative bg-background/95 border border-border rounded-xl p-6 hover:border-indigo-500/50 transition-colors">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab text-muted-foreground">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <input type="text" className="w-full bg-transparent text-white font-medium outline-none mb-4" defaultValue="Nombre del Solicitante" />
                  <div className="h-10 w-full border-b border-dashed border-border flex items-center px-2 text-muted-foreground text-sm">
                    Respuesta de texto corto
                  </div>
                </div>

                {/* Form Field 2 */}
                <div className="group relative bg-background/95 border border-border rounded-xl p-6 hover:border-indigo-500/50 transition-colors border-l-2 border-l-indigo-500">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 cursor-grab text-muted-foreground">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <input type="text" className="w-full bg-transparent text-white font-medium outline-none mb-4" defaultValue="Tipo de Incidencia" />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border border-border" />
                      <span className="text-muted-foreground text-sm">Problema de Software</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border border-border" />
                      <span className="text-muted-foreground text-sm">Problema de Hardware</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border border-border" />
                      <span className="text-muted-foreground text-sm">Acceso y Credenciales</span>
                    </div>
                  </div>
                </div>

                {/* Form Field 3 */}
                <div className="group relative bg-background/95 border border-border rounded-xl p-6 hover:border-indigo-500/50 transition-colors">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab text-muted-foreground">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <input type="text" className="w-full bg-transparent text-white font-medium outline-none mb-4" defaultValue="Descripción del problema" />
                  <div className="h-20 w-full border border-dashed border-border rounded bg-subtle/50 flex items-start p-3 text-muted-foreground text-sm">
                    Respuesta de párrafo largo
                  </div>
                </div>
              </div>

              <button className="mt-8 flex items-center gap-2 text-indigo-400 font-medium text-sm hover:text-indigo-300 transition-colors p-2 rounded hover:bg-indigo-500/10 w-full justify-center border border-dashed border-indigo-500/30">
                <Plus className="h-4 w-4" />
                Añadir nuevo campo
              </button>
            </div>
          </div>

          {/* Settings Sidebar */}
          <div className="w-72 shrink-0 space-y-6">
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold text-white flex items-center gap-2 mb-4">
                <Settings className="h-4 w-4 text-muted-foreground" />
                Reglas del Formulario
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Guardar respuestas en Lista:</label>
                  <select className="w-full bg-background border border-border rounded-md p-2 text-sm text-foreground outline-none focus:border-indigo-500">
                    <option>ITIL - Service Desk</option>
                    <option>QA - Bug Reports</option>
                  </select>
                </div>
                
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Asignar tarea automáticamente a:</label>
                  <select className="w-full bg-background border border-border rounded-md p-2 text-sm text-foreground outline-none focus:border-indigo-500">
                    <option>@ServiceDesk_Team</option>
                    <option>@Edwin_Martinez</option>
                  </select>
                </div>

                <div className="pt-4 border-t border-border">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="form-checkbox bg-background border-border text-indigo-500 rounded" defaultChecked />
                    <span className="text-sm text-foreground/90">Marcar tareas como &quot;URGENTE&quot;</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
