import { FolderKanban, Layers, Building2, Trash2 } from "lucide-react";
import Link from 'next/link';
import prisma from "@/lib/prisma";
import { createProject, deleteProject } from "@/lib/actions";
import AreaFormClient from "@/components/AreaFormClient";

export const dynamic = "force-dynamic";

export default async function ProjectsMaintenance() {
  const gerencias = await prisma.gerencia.findMany({
    include: {
      areas: {
        include: { projects: { include: { tasks: true, manager: true } } },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  const standaloneProjects = await prisma.project.findMany({
    where: { areaId: null },
    include: { tasks: true, manager: true },
    orderBy: { name: 'asc' },
  });
  const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });

  // Flatten gerencias for the AreaFormClient selector
  const gerenciasForSelector = gerencias.map(g => ({
    id: g.id,
    name: g.name,
    areas: g.areas.map(a => ({ id: a.id, name: a.name })),
  }));

  return (
    <div className="flex h-full flex-col bg-background overflow-y-auto p-8">
      <header className="mb-8 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <FolderKanban className="h-8 w-8 text-indigo-500" />
            Portafolio de Proyectos
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            CRUD completo: Crear/Editar/Eliminar Proyectos por Gerencia y Área (Supabase + Prisma)
          </p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto w-full space-y-10">
        {/* === CRUD PROYECTOS === */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <FolderKanban className="h-5 w-5 text-indigo-500" />
            Crear Proyecto
          </h2>
          <form action={createProject} className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-card border border-border rounded-xl p-5 mb-6">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Nombre del Proyecto *</label>
              <input
                name="name"
                required
                placeholder="Ej: Migración a la Nube (AWS)"
                className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Estado</label>
              <select
                name="status"
                className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="PLANNING">Planning</option>
                <option value="ACTIVE">Active</option>
                <option value="ON_HOLD">On Hold</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
              >
                Crear Proyecto
              </button>
            </div>

            {/* Gerencia → Área selectors (client component) */}
            <AreaFormClient gerencias={gerenciasForSelector} />

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Descripción</label>
              <input
                name="description"
                placeholder="Descripción y objetivos del proyecto..."
                className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </form>
        </section>

        {/* === LISTADO POR GERENCIA → ÁREA → PROYECTOS === */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">Proyectos en Base de Datos</h2>

          {gerencias.map(gerencia => (
            <div key={gerencia.id} className="mb-8">
              {/* Gerencia Header */}
              <div className="flex items-center gap-2 mb-4 bg-subtle/50 border border-border/50 rounded-lg px-4 py-3">
                <Building2 className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-widest">{gerencia.name}</h3>
                <span className="text-xs text-muted-foreground ml-2">
                  {gerencia.areas.length} área(s) · {gerencia.areas.reduce((acc, a) => acc + a.projects.length, 0)} proyecto(s)
                </span>
              </div>

              {gerencia.areas.map(area => (
                <div key={area.id} className="mb-5 ml-4">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5" /> {area.name}
                  </h4>
                  {area.projects.length > 0 ? (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {area.projects.map(project => (
                        <ProjectCard key={project.id} project={project} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic ml-6">Sin proyectos en esta área.</p>
                  )}
                </div>
              ))}

              {gerencia.areas.length === 0 && (
                <p className="text-xs text-muted-foreground italic ml-4">Sin áreas configuradas. Ve a Gerencias para crear áreas.</p>
              )}
            </div>
          ))}

          {standaloneProjects.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3">Sin Área Asignada</h3>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {standaloneProjects.map(project => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            </div>
          )}

          {gerencias.length === 0 && standaloneProjects.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay proyectos en la base de datos. Crea uno arriba.</p>
          )}
        </section>
      </div>
    </div>
  );
}

type ProjectCardData = {
  id: string;
  name: string;
  status: string;
  manager?: { name?: string | null } | null;
  tasks?: { status: string }[];
};

function ProjectCard({ project }: { project: ProjectCardData }) {
  const taskCount = project.tasks?.length || 0;
  const doneTasks = project.tasks?.filter((t) => t.status === 'DONE').length || 0;
  const progress = taskCount > 0 ? Math.round((doneTasks / taskCount) * 100) : 0;

  const statusStyle =
    project.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
    project.status === 'PLANNING' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
    project.status === 'COMPLETED' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
    'bg-amber-500/10 text-amber-400 border-amber-500/20';

  return (
    <div className="group rounded-xl bg-card border border-border p-5 hover:border-indigo-500/50 transition-all">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h4 className="text-base font-medium text-white group-hover:text-indigo-400 transition-colors">{project.name}</h4>
          <p className="text-xs text-muted-foreground mt-1">PM: {project.manager?.name || 'Sin asignar'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${statusStyle}`}>
            {project.status}
          </span>
          <form action={deleteProject}>
            <input type="hidden" name="id" value={project.id} />
            <button type="submit" className="p-1 hover:bg-red-500/20 rounded text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
              <Trash2 className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">Progreso ({doneTasks}/{taskCount})</span>
          <span className="text-foreground font-medium">{progress}%</span>
        </div>
        <div className="w-full bg-background rounded-full h-2 border border-border/50">
          <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <Link
        href="/list"
        className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 bg-indigo-500/10 px-3 py-1.5 rounded hover:bg-indigo-500/20 w-fit"
      >
        Ver Tareas ➔
      </Link>
    </div>
  );
}
