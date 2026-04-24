import { ClipboardList, Plus, Settings, Share2, Eye, GripVertical } from 'lucide-react';

export default function FormsPage() {
  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-8 bg-slate-900/50">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-indigo-400" />
            Constructor de Formularios
          </h1>
          <p className="mt-1 text-xs text-slate-400">Captura externa de tickets y requerimientos</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors border border-slate-700">
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
          <div className="flex-1 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
            <div className="h-2 bg-indigo-500" />
            <div className="p-8">
              <input 
                type="text" 
                className="w-full text-3xl font-bold bg-transparent text-white border-b border-transparent focus:border-slate-700 outline-none pb-2 mb-4"
                defaultValue="Solicitud de Soporte (ITIL)"
              />
              <textarea 
                className="w-full text-sm bg-transparent text-slate-400 border-b border-transparent focus:border-slate-700 outline-none pb-2 mb-8 resize-none"
                placeholder="Descripción del formulario..."
                defaultValue="Por favor complete este formulario para generar un ticket automático en la cola de Service Desk."
              />

              <div className="space-y-4">
                {/* Form Field 1 */}
                <div className="group relative bg-slate-950/50 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab text-slate-500">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <input type="text" className="w-full bg-transparent text-white font-medium outline-none mb-4" defaultValue="Nombre del Solicitante" />
                  <div className="h-10 w-full border-b border-dashed border-slate-700 flex items-center px-2 text-slate-500 text-sm">
                    Respuesta de texto corto
                  </div>
                </div>

                {/* Form Field 2 */}
                <div className="group relative bg-slate-950/50 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors border-l-2 border-l-indigo-500">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 cursor-grab text-slate-500">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <input type="text" className="w-full bg-transparent text-white font-medium outline-none mb-4" defaultValue="Tipo de Incidencia" />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border border-slate-600" />
                      <span className="text-slate-400 text-sm">Problema de Software</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border border-slate-600" />
                      <span className="text-slate-400 text-sm">Problema de Hardware</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border border-slate-600" />
                      <span className="text-slate-400 text-sm">Acceso y Credenciales</span>
                    </div>
                  </div>
                </div>

                {/* Form Field 3 */}
                <div className="group relative bg-slate-950/50 border border-slate-800 rounded-xl p-6 hover:border-indigo-500/50 transition-colors">
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 cursor-grab text-slate-500">
                    <GripVertical className="h-5 w-5" />
                  </div>
                  <input type="text" className="w-full bg-transparent text-white font-medium outline-none mb-4" defaultValue="Descripción del problema" />
                  <div className="h-20 w-full border border-dashed border-slate-700 rounded bg-slate-900/50 flex items-start p-3 text-slate-500 text-sm">
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
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="font-semibold text-white flex items-center gap-2 mb-4">
                <Settings className="h-4 w-4 text-slate-400" />
                Reglas del Formulario
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Guardar respuestas en Lista:</label>
                  <select className="w-full bg-slate-950 border border-slate-700 rounded-md p-2 text-sm text-slate-200 outline-none focus:border-indigo-500">
                    <option>ITIL - Service Desk</option>
                    <option>QA - Bug Reports</option>
                  </select>
                </div>
                
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Asignar tarea automáticamente a:</label>
                  <select className="w-full bg-slate-950 border border-slate-700 rounded-md p-2 text-sm text-slate-200 outline-none focus:border-indigo-500">
                    <option>@ServiceDesk_Team</option>
                    <option>@Edwin_Martinez</option>
                  </select>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="form-checkbox bg-slate-950 border-slate-700 text-indigo-500 rounded" defaultChecked />
                    <span className="text-sm text-slate-300">Marcar tareas como "URGENTE"</span>
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
