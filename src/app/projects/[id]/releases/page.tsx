import prisma from '@/lib/prisma'
import { listReleasesForProject } from '@/lib/actions/releases'
import ReleasesClient from '@/components/releases/ReleasesClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProjectReleasesPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, releases, users, epics, sprints] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    listReleasesForProject(projectId),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.epic.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, name: true, color: true },
      orderBy: { position: 'asc' },
    }),
    // Sprints activos (no terminados aún) para ofrecerlos en el modal.
    prisma.sprint.findMany({
      where: { projectId, endedAt: null },
      select: { id: true, name: true, startDate: true, endDate: true },
      orderBy: { startDate: 'asc' },
    }),
  ])

  if (!project) notFound()

  const serializedSprints = sprints.map((s) => ({
    id: s.id,
    name: s.name,
    startDate: s.startDate?.toISOString() ?? null,
    endDate: s.endDate?.toISOString() ?? null,
  }))

  return (
    <div className="flex h-full flex-col bg-background">
      <ReleasesClient
        project={project}
        releases={releases}
        users={users}
        epics={epics}
        sprints={serializedSprints}
      />
    </div>
  )
}
