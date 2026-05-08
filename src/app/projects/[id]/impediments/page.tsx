import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import prisma from '@/lib/prisma'
import { ImpedimentsClient } from '@/components/impediments/ImpedimentsClient'
import { listImpediments } from '@/lib/actions/impediments'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function ProjectImpedimentsPage({ params }: PageProps) {
  const { id: projectId } = await params

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      sprints: {
        where: { status: { in: ['ACTIVE', 'PLANNING'] } },
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true },
        take: 1,
      },
      assignments: {
        select: { user: { select: { id: true, name: true } } },
      },
    },
  })
  if (!project) notFound()

  const activeSprint = project.sprints[0]
  const currentUser = await getCurrentUserPresence()

  if (!activeSprint) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background p-10">
        <div className="max-w-md rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-orange-400" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            No hay sprint activo
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Los impediments se registran a nivel sprint.
          </p>
          <Link
            href={`/projects/${project.id}/sprints`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-500"
          >
            Ir a Sprints
          </Link>
        </div>
      </div>
    )
  }

  const impediments = await listImpediments({ sprintId: activeSprint.id })
  const team = project.assignments
    .map((a) => a.user)
    .filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i)

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href={`/projects/${project.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> {project.name}
          </Link>
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <ShieldAlert className="h-5 w-5 text-orange-400" />
            Impediments
          </h1>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <ImpedimentsClient
          sprintId={activeSprint.id}
          sprintName={activeSprint.name}
          projectId={project.id}
          team={team}
          impediments={impediments.map((i) => ({
            id: i.id,
            title: i.title,
            description: i.description,
            severity: i.severity,
            status: i.status,
            raisedAt: i.raisedAt,
            resolvedAt: i.resolvedAt,
            resolutionNotes: i.resolutionNotes,
            raisedBy: i.raisedBy,
            owner: i.owner,
            sprint: { id: i.sprint.id, name: i.sprint.name },
          }))}
          currentUser={
            currentUser
              ? { id: currentUser.userId, name: currentUser.name }
              : null
          }
        />
      </div>
    </div>
  )
}
