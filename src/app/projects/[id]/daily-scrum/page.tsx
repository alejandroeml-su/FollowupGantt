import Link from 'next/link'
import { ArrowLeft, CalendarClock } from 'lucide-react'
import type { ImprovementStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { DailyScrumClient } from '@/components/daily-scrum/DailyScrumClient'
import { listDailyScrums } from '@/lib/actions/daily-scrum'
import { listImpediments } from '@/lib/actions/impediments'
import { listImprovements } from '@/lib/actions/improvements'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { notFound } from 'next/navigation'

// Wave P14e — Helper async aislado · puede usar Date.now() sin chocar
// con react-hooks/purity (que solo aplica a renders sync).
async function buildImprovementsPayload(
  items: Array<{
    id: string
    title: string
    status: ImprovementStatus
    dueDate: Date | null
    owner: { id: string; name: string } | null
    retrospective: { id: string; title: string; sprint: { id: string; name: string } } | null
  }>,
) {
  const nowMs = Date.now()
  return items.map((i) => ({
    id: i.id,
    title: i.title,
    status: i.status,
    dueDate: i.dueDate,
    isOverdue: !!(
      i.dueDate &&
      i.status !== 'DONE' &&
      i.dueDate.getTime() < nowMs
    ),
    ownerName: i.owner?.name ?? null,
    sprintName: i.retrospective?.sprint.name ?? null,
  }))
}

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function ProjectDailyScrumPage({ params }: PageProps) {
  const { id: projectId } = await params

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      sprints: {
        where: { status: 'ACTIVE' },
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true },
        take: 1,
      },
      assignments: {
        select: {
          user: { select: { id: true, name: true } },
        },
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
          <CalendarClock className="mx-auto h-10 w-10 text-emerald-400" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            No hay un sprint activo
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Inicia un sprint para registrar Daily Scrums.
          </p>
          <Link
            href={`/projects/${project.id}/sprints`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Ir a Sprints
          </Link>
        </div>
      </div>
    )
  }

  // Wave P14e (HU-12.5 refinements) — cargar Impediments del sprint +
  // Improvement Items del proyecto en paralelo para mostrarlos como
  // contexto vivo en el Daily Scrum widget.
  const [recent, impedimentsAll, improvementsAll] = await Promise.all([
    listDailyScrums({ sprintId: activeSprint.id, limit: 10 }),
    listImpediments({ sprintId: activeSprint.id }),
    listImprovements({ projectId: project.id }),
  ])

  // Solo activos (OPEN/IN_PROGRESS/ESCALATED) para el panel del daily.
  const activeImpediments = impedimentsAll.filter(
    (i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ESCALATED',
  )
  const pendingImprovements = improvementsAll.filter(
    (i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS',
  )

  const team = project.assignments
    .map((a) => a.user)
    .filter((u, i, arr) => arr.findIndex((x) => x.id === u.id) === i)

  // Wave P14e — calcular `isOverdue` server-side (Date.now() impuro en
  // client render React 19). Esta función async server-side puede usar
  // funciones impuras sin restricción.
  const improvementsPayload = await buildImprovementsPayload(pendingImprovements)

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
            <CalendarClock className="h-5 w-5 text-emerald-400" />
            Daily Scrum
          </h1>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <DailyScrumClient
          sprintId={activeSprint.id}
          sprintName={activeSprint.name}
          projectId={project.id}
          team={team}
          recent={recent.map((d) => ({
            id: d.id,
            scheduledFor: d.scheduledFor,
            data: d.data,
            notes: d.notes,
            facilitator: d.facilitator,
          }))}
          impediments={activeImpediments.map((i) => ({
            id: i.id,
            title: i.title,
            severity: i.severity,
            status: i.status,
            ownerName: i.owner?.name ?? null,
            raisedAt: i.raisedAt,
          }))}
          improvements={improvementsPayload}
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
