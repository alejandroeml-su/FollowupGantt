import prisma from "@/lib/prisma";
import { getServerT } from "@/lib/i18n/server";

export default async function HomePage() {
  const tt = await getServerT();
  const projects = await prisma.project.findMany({
    include: { _count: { select: { tasks: true } } }
  });

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex-1 overflow-auto p-12 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-12">
          <header className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold uppercase tracking-widest animate-pulse">
              {tt('common.appName')}
            </div>
            <h1 className="text-5xl font-black text-foreground tracking-tight leading-none">
              {tt('pages.dashboard.title')}
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl leading-relaxed">
              {tt('pages.dashboard.subtitle')}
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase">{tt('pages.dashboard.activeProjects')}</p>
                <p className="text-4xl font-black text-foreground">{projects.length}</p>
             </div>
             <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase">{tt('pages.dashboard.totalTasks')}</p>
                <p className="text-4xl font-black text-indigo-500">{projects.reduce((acc, p) => acc + p._count.tasks, 0)}</p>
             </div>
             <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase">{tt('pages.dashboard.environment')}</p>
                <p className="text-4xl font-black text-emerald-500">PRO</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
