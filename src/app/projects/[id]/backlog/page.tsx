import prisma from '@/lib/prisma'
import { listBacklogForProject } from '@/lib/actions/backlog'
import BacklogClient, { type SprintBacklogGroup } from '@/components/backlog/BacklogClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

export default async function ProjectBacklogPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, productBacklog, sprintsWithTasks, epics] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    listBacklogForProject(projectId),
    // Sprints no terminados con sus tasks asignadas (Sprint Backlogs).
    prisma.sprint.findMany({
      where: { projectId, endedAt: null },
      select: {
        id: true,
        name: true,
        goal: true,
        startDate: true,
        endDate: true,
        capacity: true,
        tasks: {
          where: { archivedAt: null, parentId: null },
          select: {
            id: true,
            mnemonic: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            type: true,
            storyPoints: true,
            position: true,
            assignee: { select: { id: true, name: true } },
            epic: { select: { id: true, name: true, color: true } },
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { startDate: 'asc' },
    }),
    prisma.epic.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, name: true, color: true },
      orderBy: { position: 'asc' },
    }),
  ])

  if (!project) notFound()

  const serializedSprints = sprintsWithTasks.map((s) => ({
    id: s.id,
    name: s.name,
    startDate: s.startDate?.toISOString() ?? null,
    endDate: s.endDate?.toISOString() ?? null,
    capacity: s.capacity ?? null,
  }))

  // Para tabs Sprint Backlog: cada sprint con sus tasks (con sort priority).
  const sprintBacklogs: SprintBacklogGroup[] = sprintsWithTasks.map((s) => ({
    sprintId: s.id,
    sprintName: s.name,
    sprintGoal: s.goal,
    capacity: s.capacity ?? null,
    startDate: s.startDate?.toISOString() ?? null,
    endDate: s.endDate?.toISOString() ?? null,
    tasks: s.tasks
      .map((t) => ({
        id: t.id,
        mnemonic: t.mnemonic,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        type: t.type,
        storyPoints: t.storyPoints,
        position: t.position,
        assignee: t.assignee,
        epic: t.epic,
      }))
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 99
        const pb = PRIORITY_ORDER[b.priority] ?? 99
        if (pa !== pb) return pa - pb
        return a.position - b.position
      }),
  }))

  return (
    <div className="flex h-full flex-col bg-background">
      <BacklogClient
        project={project}
        initialBacklog={productBacklog}
        sprints={serializedSprints}
        epics={epics}
        sprintBacklogs={sprintBacklogs}
      />
    </div>
  )
}
