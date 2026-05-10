import prisma from '@/lib/prisma'
import { listEpicsForProject } from '@/lib/actions/epics'
import EpicsClient from '@/components/epics/EpicsClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProjectEpicsPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, epics, users, releases] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    listEpicsForProject(projectId),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    // Wave P9 follow-up — Releases activas para asociar la Epic al crear.
    prisma.release.findMany({
      where: { projectId, archivedAt: null, releasedDate: null },
      select: { id: true, name: true, version: true, scopeMode: true },
      orderBy: { plannedDate: 'asc' },
    }),
  ])

  if (!project) notFound()

  const serializedEpics = epics.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    color: e.color,
    status: e.status,
    ownerId: e.ownerId,
    ownerName: e.owner?.name ?? null,
    plannedStartDate: e.plannedStartDate?.toISOString() ?? null,
    plannedEndDate: e.plannedEndDate?.toISOString() ?? null,
    taskCount: e._count.tasks,
    archivedAt: e.archivedAt?.toISOString() ?? null,
    releaseId: e.releases[0]?.releaseId ?? null,
  }))

  return (
    <div className="flex h-full flex-col bg-background">
      <EpicsClient
        project={project}
        epics={serializedEpics}
        users={users}
        releases={releases}
      />
    </div>
  )
}
