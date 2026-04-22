import { Activity, CheckCircle2, Clock, ListTodo, TrendingUp } from "lucide-react";

export default function Dashboard() {
  // Mock data para el Dashboard inicial (luego se conectará a Prisma)
  const kpis = [
    { name: "Proyectos Activos", value: "3", icon: Activity, color: "text-blue-400", bg: "bg-blue-400/10" },
    { name: "Tareas Completadas", value: "24", icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-400/10" },
    { name: "En Progreso (WIP)", value: "12", icon: Clock, color: "text-amber-400", bg: "bg-amber-400/10" },
    { name: "Backlog", value: "45", icon: ListTodo, color: "text-slate-400", bg: "bg-slate-400/10" },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard Principal</h1>
            <p className="mt-2 text-sm text-slate-400">
              Resumen ejecutivo de la Orquestación de Trabajo Híbrida
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-indigo-500/10 px-4 py-2 text-indigo-400 border border-indigo-500/20 shadow-sm">
            <TrendingUp className="h-4 w-4" />
            <span className="text-sm font-semibold">SPI: 1.05</span>
          </div>
        </header>

        {/* KPIs Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.name}
                className="overflow-hidden rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-sm hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center">
                  <div className={`rounded-lg p-3 ${kpi.bg}`}>
                    <Icon className={`h-6 w-6 ${kpi.color}`} />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="truncate text-sm font-medium text-slate-400">
                        {kpi.name}
                      </dt>
                      <dd>
                        <div className="text-3xl font-semibold text-white mt-1">
                          {kpi.value}
                        </div>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Widgets Area */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Burnup / CFD Mock Chart */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-sm">
            <h3 className="text-lg font-medium text-white mb-4 flex items-center">
              <Activity className="h-5 w-5 mr-2 text-indigo-400" />
              Flujo Acumulado (CFD)
            </h3>
            <div className="flex h-64 items-end gap-2 rounded-lg bg-slate-950/50 p-4 border border-slate-800/50">
              {/* Fake bars for CFD */}
              {[40, 55, 65, 80, 90, 85, 100].map((h, i) => (
                <div key={i} className="flex-1 flex flex-col justify-end h-full gap-1">
                  <div className="w-full bg-slate-700 rounded-t-sm" style={{ height: `${100 - h}%` }}></div>
                  <div className="w-full bg-amber-500/80 rounded-t-sm" style={{ height: `${h * 0.3}%` }}></div>
                  <div className="w-full bg-indigo-500/80 rounded-t-sm" style={{ height: `${h * 0.7}%` }}></div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-center gap-4 text-xs text-slate-400">
              <span className="flex items-center"><div className="w-3 h-3 bg-indigo-500/80 rounded-sm mr-1"></div> Terminado</span>
              <span className="flex items-center"><div className="w-3 h-3 bg-amber-500/80 rounded-sm mr-1"></div> En Progreso</span>
              <span className="flex items-center"><div className="w-3 h-3 bg-slate-700 rounded-sm mr-1"></div> Backlog</span>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-sm">
            <h3 className="text-lg font-medium text-white mb-4">Actividad Reciente</h3>
            <div className="space-y-6">
              {[
                { task: "Configuración Base de Datos", status: "Completado", time: "Hace 2 horas" },
                { task: "Diseño UX/UI Kanban", status: "En Progreso", time: "Hace 4 horas" },
                { task: "Revisión de SLA ITIL", status: "Bloqueado", time: "Ayer" },
              ].map((item, i) => (
                <div key={i} className="flex gap-4">
                  <div className="relative mt-1 flex h-3 w-3 flex-none items-center justify-center">
                    <div className={`h-2 w-2 rounded-full ring-2 ring-slate-900 ${item.status === 'Completado' ? 'bg-emerald-400' : item.status === 'En Progreso' ? 'bg-amber-400' : 'bg-red-400'}`} />
                  </div>
                  <div className="flex-auto">
                    <p className="text-sm font-medium text-slate-200">{item.task}</p>
                    <p className="text-xs text-slate-500">{item.time}</p>
                  </div>
                  <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${item.status === 'Completado' ? 'bg-emerald-400/10 text-emerald-400 ring-emerald-400/20' : item.status === 'En Progreso' ? 'bg-amber-400/10 text-amber-400 ring-amber-400/20' : 'bg-red-400/10 text-red-400 ring-red-400/20'}`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
