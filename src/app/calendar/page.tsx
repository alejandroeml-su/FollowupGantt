import { Calendar, Sparkles, Info } from "lucide-react";

export default function CalendarPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-center justify-between border-b border-slate-800 pb-6">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-indigo-500/10 p-3 ring-1 ring-indigo-500/20">
              <Calendar className="h-8 w-8 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">Calendar View</h1>
              <p className="mt-1 text-sm text-slate-400 flex items-center gap-2">
                 <Info className="h-4 w-4" /> Planificación temporal y sincronización para evitar solapamientos.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 transition-colors">
              <Sparkles className="h-4 w-4" />
              ClickUp Brain
            </button>
          </div>
        </header>

        <div className="flex h-[60vh] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/50">
          <div className="rounded-full bg-slate-800 p-4 mb-4">
            <Calendar className="h-10 w-10 text-slate-500" />
          </div>
          <h2 className="text-xl font-semibold text-white">Módulo Calendar View en Construcción</h2>
          <p className="mt-2 text-slate-400 max-w-md text-center">
            Esta vista premium ha sido provisionada arquitectónicamente para el Release correspondiente. Las integraciones con Prisma y los componentes React están en la cola de desarrollo del SDLC Autónomo.
          </p>
        </div>
      </div>
    </div>
  );
}
