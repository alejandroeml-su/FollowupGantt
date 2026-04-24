import prisma from '@/lib/prisma'
import { serializeTask } from '@/lib/types'
import { MindMapsBoardClient } from '@/components/interactions/MindMapsBoardClient'

export const dynamic = 'force-dynamic'

export default async function MindMapsPage() {
  const [projects, projectCatalog, users, gerencias, areas] = await Promise.all([
    prisma.project.findMany({
      include: {
        area: { include: { gerencia: true } },
        tasks: {
          where: { parentId: null },
          include: {
            assignee: true,
            project: { include: { area: { include: { gerencia: true } } } },
            subtasks: {
              include: {
                assignee: true,
                project: { include: { area: { include: { gerencia: true } } } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.project.findMany({ select: { id: true, name: true, areaId: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.gerencia.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.area.findMany({ select: { id: true, name: true, gerenciaId: true }, orderBy: { name: 'asc' } }),
  ])

  const serialized = projects.map(p => ({
    id: p.id,
    name: p.name,
    areaId: p.areaId,
    tasks: p.tasks.map((t: Record<string, unknown>) => {
      const st = serializeTask(t)
      const raw = t as { subtasks?: Record<string, unknown>[] }
      return {
        ...st,
        subtasks: Array.isArray(raw.subtasks) ? raw.subtasks.map(s => serializeTask(s)) : [],
      }
    }),
  }))

  return (
    <MindMapsBoardClient
      projects={serialized}
      projectCatalog={projectCatalog}
      users={users}
      gerencias={gerencias}
      areas={areas}
    />
  )
}
