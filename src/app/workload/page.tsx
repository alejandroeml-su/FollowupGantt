import { TrendingUp, AlertCircle, Clock } from 'lucide-react';
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function WorkloadPage() {
  const users = await prisma.user.findMany({
    include: {
      roles: { include: { role: true } },
      tasks: {
        where: { status: { not: 'DONE' } },
        include: { project: true }
      }
    }
  });

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Workload & Capacity (Supabase SSR)</h1>
          <p className="mt-1 text-xs text-muted-foreground">Control de capacidad operativa y carga por recurso</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-foreground/90 hover:bg-secondary/80 transition-colors border border-border">
            <TrendingUp className="h-4 w-4 text-indigo-400" />
            Optimizar Capacidad
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {users.map(user => {
            const activeTasks = user.tasks.length;
            // Falso límite de WIP para demostración
            const capacityLimit = 5; 
            const isOverloaded = activeTasks > capacityLimit;
            const progress = Math.min(100, (activeTasks / capacityLimit) * 100);

            return (
              <div key={user.id} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                {/* User Header */}
                <div className="flex items-center justify-between bg-secondary/30 p-4 border-b border-border">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-bold">
                      {user.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{user.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {user.roles.map(r => r.role.name).join(', ') || 'Sin Rol'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-sm font-medium text-foreground/90">
                      {activeTasks} / {capacityLimit} Tareas
                    </span>
                    <div className="w-48 h-2.5 rounded-full bg-background border border-border overflow-hidden flex">
                      <div 
                        className={`h-full transition-all ${isOverloaded ? 'bg-red-500' : progress > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    {isOverloaded && (
                      <span className="text-[10px] text-red-400 flex items-center mt-1">
                        <AlertCircle className="h-3 w-3 mr-1" /> Sobrecarga detectada
                      </span>
                    )}
                  </div>
                </div>

                {/* User Tasks List */}
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {user.tasks.length === 0 ? (
                    <div className="col-span-2 text-sm text-muted-foreground py-2">
                      Sin tareas activas asignadas.
                    </div>
                  ) : (
                    user.tasks.map(task => (
                      <div key={task.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-background/95 hover:border-border transition-colors">
                        {task.status === 'IN_PROGRESS' ? (
                          <Clock className="h-4 w-4 text-indigo-400" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border-2 border-slate-500" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{task.project?.name || 'General'}</p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${
                          task.priority === 'CRITICAL' ? 'bg-red-500/15 text-red-300' :
                          task.priority === 'HIGH' ? 'bg-amber-500/15 text-amber-300' : 'bg-secondary text-muted-foreground'
                        }`}>
                          {task.priority}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
