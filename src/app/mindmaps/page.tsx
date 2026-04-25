import { Network, Plus, AlertTriangle, Database } from 'lucide-react'
import prisma from '@/lib/prisma'
import { MindMapListClient } from '@/components/mindmap/MindMapListClient'

export const dynamic = 'force-dynamic'

export default async function MindMapsPage() {
  // Defensive load: si las tablas MindMap aún no existen en la BD (caso del
  // 500 actual en /mindmaps tras merge del PR #8 sin aplicar migración), no
  // tumbamos toda la página — mostramos un banner de setup pendiente.
  let mindMaps: Awaited<ReturnType<typeof loadMindMaps>>
  let projects: { id: string; name: string }[]
  let users: { id: string; name: string }[]
  try {
    ;[mindMaps, projects, users] = await Promise.all([
      loadMindMaps(),
      prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])
  } catch (err) {
    return <SetupPending error={err instanceof Error ? err.message : 'Error desconocido'} />
  }

  const serialized = mindMaps.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    project: m.project,
    owner: m.owner,
    nodeCount: m._count.nodes,
    edgeCount: m._count.edges,
    updatedAt: m.updatedAt.toISOString(),
  }))

  return (
    <div className="p-8 space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Network className="h-6 w-6 text-primary" />
            Mapas Mentales
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Brainstorming visual, WBS, mapas de conocimiento. Inspirado en MindMup 3.
          </p>
        </div>
      </header>

      {mindMaps.length === 0 ? (
        <EmptyState />
      ) : (
        <MindMapListClient mindMaps={serialized} projects={projects} users={users} />
      )}

      {/* Entry point fuera del cliente para SSR + progressive enhancement */}
      {mindMaps.length === 0 && (
        <div className="flex justify-center">
          <MindMapListClient mindMaps={[]} projects={projects} users={users} showEmpty={false} />
        </div>
      )}
    </div>
  )
}

function loadMindMaps() {
  return prisma.mindMap.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      project: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      _count: { select: { nodes: true, edges: true } },
    },
  })
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-border bg-subtle/40 p-12 text-center space-y-4">
      <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
        <Plus className="h-6 w-6 text-primary" />
      </div>
      <div>
        <p className="text-base font-semibold text-foreground">Aún no hay mapas mentales</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Crea tu primer mapa para organizar ideas, planear proyectos o documentar procesos de forma visual.
        </p>
      </div>
    </div>
  )
}

function SetupPending({ error }: { error: string }) {
  const isMissingTable = /does not exist|relation .* does not exist|P2021/i.test(error)
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Network className="h-6 w-6 text-primary" />
          Mapas Mentales
        </h1>
      </header>

      <div className="rounded-2xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 p-8 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-base font-semibold text-foreground">
              Módulo pendiente de configuración en la base de datos
            </p>
            <p className="text-sm text-muted-foreground">
              {isMissingTable ? (
                <>
                  Las tablas <code>MindMap</code>, <code>MindMapNode</code> y{' '}
                  <code>MindMapEdge</code> aún no existen en la base de datos. El módulo se
                  desplegó sin aplicar la migración correspondiente.
                </>
              ) : (
                <>No se pudo conectar con la base de datos para cargar los mapas mentales.</>
              )}
            </p>
          </div>
        </div>

        {isMissingTable && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-primary" />
              Para resolverlo (administrador)
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
              <li>
                Aplicar la migración SQL en Supabase:
                <code className="ml-1 block bg-background border border-border rounded px-2 py-1 mt-1 text-foreground/90 font-mono">
                  prisma/migrations/20260425_mindmap_tables/migration.sql
                </code>
              </li>
              <li>
                O ejecutar <code className="font-mono">npx prisma db push</code> apuntando a la BD
                de producción.
              </li>
              <li>Recargar esta página.</li>
            </ol>
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Detalle técnico</summary>
          <pre className="mt-2 bg-card border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {error}
          </pre>
        </details>
      </div>
    </div>
  )
}
