import { Network, Plus } from 'lucide-react'
import prisma from '@/lib/prisma'
import { MindMapListClient } from '@/components/mindmap/MindMapListClient'

export const dynamic = 'force-dynamic'

export default async function MindMapsPage() {
  const [mindMaps, projects, users] = await Promise.all([
    prisma.mindMap.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        project: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        _count: { select: { nodes: true, edges: true } },
      },
    }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

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
