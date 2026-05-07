import prisma from '@/lib/prisma'
import { listBacklogForProject } from '@/lib/actions/backlog'
import SprintPlanningClient from '@/components/sprint-planning/SprintPlanningClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string; sprintId: string }>
}

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

export default async function SprintPlanningPage({ params }: PageProps) {
  const { id: projectId, sprintId } = await params

  const [project, sprint, backlog, sprintTasks, recentSprints, epics] =
    await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true },
      }),
      prisma.sprint.findUnique({
        where: { id: sprintId },
        select: {
          id: true,
          name: true,
          goal: true,
          startDate: true,
          endDate: true,
          capacity: true,
          velocityActual: true,
          startedAt: true,
          endedAt: true,
          projectId: true,
        },
      }),
      listBacklogForProject(projectId),
      prisma.task.findMany({
        where: {
          projectId,
          sprintId,
          parentId: null,
          archivedAt: null,
        },
        select: {
          id: true,
          mnemonic: true,
          title: true,
          status: true,
          priority: true,
          storyPoints: true,
          position: true,
          assignee: { select: { id: true, name: true } },
          epic: { select: { id: true, name: true, color: true } },
        },
      }),
      // Velocity histórica: últimos 3 sprints terminados (con
      // `velocityActual` no null) para hint de planning.
      prisma.sprint.findMany({
        where: {
          projectId,
          endedAt: { not: null },
          velocityActual: { not: null },
          NOT: { id: sprintId },
        },
        select: { id: true, name: true, velocityActual: true, capacity: true },
        orderBy: { endedAt: 'desc' },
        take: 3,
      }),
      prisma.epic.findMany({
        where: { projectId, archivedAt: null },
        select: { id: true, name: true, color: true },
        orderBy: { position: 'asc' },
      }),
    ])

  if (!project) notFound()
  if (!sprint || sprint.projectId !== projectId) notFound()

  // Sort sprintTasks por priority + position (mismo criterio del backlog).
  const sortedSprintTasks = [...sprintTasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99
    const pb = PRIORITY_ORDER[b.priority] ?? 99
    if (pa !== pb) return pa - pb
    return a.position - b.position
  })

  return (
    <div className="flex h-full flex-col bg-background">
      <SprintPlanningClient
        project={project}
        sprint={{
          id: sprint.id,
          name: sprint.name,
          goal: sprint.goal,
          startDate: sprint.startDate.toISOString(),
          endDate: sprint.endDate.toISOString(),
          capacity: sprint.capacity,
          velocityActual: sprint.velocityActual,
          startedAt: sprint.startedAt?.toISOString() ?? null,
          endedAt: sprint.endedAt?.toISOString() ?? null,
        }}
        initialBacklog={backlog}
        initialSprintTasks={sortedSprintTasks}
        recentSprints={recentSprints.map((s) => ({
          id: s.id,
          name: s.name,
          velocityActual: s.velocityActual ?? 0,
          capacity: s.capacity,
        }))}
        epics={epics}
      />
    </div>
  )
}
