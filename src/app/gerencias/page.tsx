import { Building2, Layers, Trash2, Plus, FolderTree } from "lucide-react";
import prisma from "@/lib/prisma";
import { createGerencia, deleteGerencia, createArea, deleteArea } from "@/lib/actions";
import GerenciaEditModal from "@/components/GerenciaEditModal";

export const dynamic = "force-dynamic";

// Color palette for gerencia cards
const cardColors = [
  { bg: 'from-indigo-500/10 to-indigo-600/5', border: 'border-indigo-500/20', icon: 'text-indigo-400', badge: 'bg-indigo-500/15 text-indigo-300' },
  { bg: 'from-emerald-500/10 to-emerald-600/5', border: 'border-emerald-500/20', icon: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300' },
  { bg: 'from-amber-500/10 to-amber-600/5', border: 'border-amber-500/20', icon: 'text-amber-400', badge: 'bg-amber-500/15 text-amber-300' },
  { bg: 'from-rose-500/10 to-rose-600/5', border: 'border-rose-500/20', icon: 'text-rose-400', badge: 'bg-rose-500/15 text-rose-300' },
  { bg: 'from-cyan-500/10 to-cyan-600/5', border: 'border-cyan-500/20', icon: 'text-cyan-400', badge: 'bg-cyan-500/15 text-cyan-300' },
  { bg: 'from-violet-500/10 to-violet-600/5', border: 'border-violet-500/20', icon: 'text-violet-400', badge: 'bg-violet-500/15 text-violet-300' },
  { bg: 'from-fuchsia-500/10 to-fuchsia-600/5', border: 'border-fuchsia-500/20', icon: 'text-fuchsia-400', badge: 'bg-fuchsia-500/15 text-fuchsia-300' },
  { bg: 'from-teal-500/10 to-teal-600/5', border: 'border-teal-500/20', icon: 'text-teal-400', badge: 'bg-teal-500/15 text-teal-300' },
];

export default async function GerenciasPage() {
  const gerencias = await prisma.gerencia.findMany({
    include: {
      areas: {
        include: {
          projects: true,
        },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="flex h-full flex-col bg-slate-950 overflow-y-auto p-8">
      <header className="mb-8 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              <Building2 className="h-8 w-8 text-indigo-500" />
              Catálogo de Gerencias
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Estructura organizacional: Gerencia → Áreas → Proyectos. CRUD completo con Supabase + Prisma.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2">
              <Building2 className="h-4 w-4 text-indigo-400" />
              <span className="text-sm font-medium text-slate-300">{gerencias.length} Gerencias</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2">
              <FolderTree className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-medium text-slate-300">
                {gerencias.reduce((acc, g) => acc + g.areas.length, 0)} Áreas
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto w-full space-y-8">
        {/* === CREAR GERENCIA === */}
        <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Plus className="h-5 w-5 text-indigo-400" />
            Nueva Gerencia
          </h2>
          <form action={createGerencia} className="flex flex-col md:flex-row gap-3">
            <input
              name="name"
              required
              placeholder="Nombre de la Gerencia (Ej: TECNOLOGÍA)"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 py-2.5 px-4 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
            />
            <input
              name="description"
              placeholder="Descripción (opcional)"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 py-2.5 px-4 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
            />
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-all hover:shadow-lg hover:shadow-indigo-500/20 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Crear Gerencia
            </button>
          </form>
        </section>

        {/* === LISTADO DE GERENCIAS === */}
        <section className="space-y-6">
          {gerencias.map((gerencia, idx) => {
            const color = cardColors[idx % cardColors.length];
            const totalProjects = gerencia.areas.reduce((acc, a) => acc + a.projects.length, 0);

            return (
              <div
                key={gerencia.id}
                className={`bg-gradient-to-br ${color.bg} border ${color.border} rounded-2xl overflow-hidden transition-all hover:shadow-lg`}
              >
                {/* Header de la Gerencia */}
                <div className="px-6 py-5 flex items-center justify-between border-b border-slate-800/50">
                  <div className="flex items-center gap-4">
                    <div className={`h-12 w-12 rounded-xl bg-slate-900/80 flex items-center justify-center border border-slate-700/50`}>
                      <Building2 className={`h-6 w-6 ${color.icon}`} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-wide">{gerencia.name}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {gerencia.description || 'Sin descripción'} · {gerencia.areas.length} área(s) · {totalProjects} proyecto(s)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium ${color.badge}`}>
                      {gerencia.areas.length} Áreas
                    </span>
                    <GerenciaEditModal gerencia={gerencia} />
                    <form action={deleteGerencia}>
                      <input type="hidden" name="id" value={gerencia.id} />
                      <button
                        type="submit"
                        className="p-2 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                        title="Eliminar Gerencia"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                </div>

                {/* Áreas de esta Gerencia */}
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5" />
                      Áreas Dependientes
                    </h4>
                  </div>

                  {/* Form para crear área en esta gerencia */}
                  <form action={createArea} className="flex gap-2 mb-4">
                    <input type="hidden" name="gerenciaId" value={gerencia.id} />
                    <input
                      name="name"
                      required
                      placeholder={`Nueva área para ${gerencia.name}...`}
                      className="flex-1 rounded-lg border border-slate-700/50 bg-slate-950/50 py-2 px-3 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-all"
                    />
                    <input
                      name="description"
                      placeholder="Descripción (opcional)"
                      className="flex-1 rounded-lg border border-slate-700/50 bg-slate-950/50 py-2 px-3 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-all"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Área
                    </button>
                  </form>

                  {/* Listado de áreas */}
                  {gerencia.areas.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {gerencia.areas.map(area => (
                        <div
                          key={area.id}
                          className="group flex items-center justify-between bg-slate-900/60 border border-slate-800/50 rounded-xl p-3.5 hover:border-slate-700 transition-all"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-200 truncate">{area.name}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {area.projects.length} proyecto(s) — {area.description || 'Sin descripción'}
                            </p>
                          </div>
                          <form action={deleteArea}>
                            <input type="hidden" name="id" value={area.id} />
                            <button
                              type="submit"
                              className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                              title="Eliminar Área"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 italic py-2">
                      No hay áreas asignadas a esta gerencia. Crea una arriba.
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {gerencias.length === 0 && (
            <div className="text-center py-16 bg-slate-900/30 border border-slate-800 border-dashed rounded-2xl">
              <Building2 className="h-12 w-12 text-slate-700 mx-auto mb-4" />
              <p className="text-sm text-slate-500 font-medium">No hay gerencias registradas.</p>
              <p className="text-xs text-slate-600 mt-1">Crea tu primera gerencia usando el formulario de arriba.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
