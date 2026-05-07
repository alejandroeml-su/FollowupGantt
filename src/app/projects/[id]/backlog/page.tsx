import prisma from '@/lib/prisma'
import { listBacklogForProject } from '@/lib/actions/backlog'
import BacklogClient from '@/components/backlog/BacklogClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProjectBacklogPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, backlog, sprints, epics] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    listBacklogForProject(projectId),
    // Sprints no terminados (sin endedAt) para asignar desde el backlog.
    prisma.sprint.findMany({
      where: { projectId, endedAt: null },
      select: { id: true, name: true, startDate: true, endDate: true, capacity: true },
      orderBy: { startDate: 'asc' },
    }),
    prisma.epic.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, name: true, color: true },
      orderBy: { position: 'asc' },
    }),
  ])

  if (!project) notFound()

  const serializedSprints = sprints.map((s) => ({
    id: s.id,
    name: s.name,
    startDate: s.startDate?.toISOString() ?? null,
    endDate: s.endDate?.toISOString() ?? null,
    capacity: s.capacity ?? null,
  }))

  return (
    <div className="flex h-full flex-col bg-background">
      <BacklogClient
        project={project}
        initialBacklog={backlog}
        sprints={serializedSprints}
        epics={epics}
      />
    </div>
  )
}
