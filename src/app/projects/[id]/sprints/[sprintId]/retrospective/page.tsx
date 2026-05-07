import Link from 'next/link'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import prisma from '@/lib/prisma'
import RetrospectiveBoard from '@/components/retrospective/RetrospectiveBoard'
import { RetrospectiveSetup } from '@/components/retrospective/RetrospectiveSetup'
import {
  formatLabel,
  normalizeData,
  type RetrospectiveFormat,
} from '@/lib/retrospective/types'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string; sprintId: string }>
}

export default async function SprintRetrospectivePage({ params }: PageProps) {
  const { id: projectId, sprintId } = await params

  const [project, sprint, currentUser] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { id: true, name: true, projectId: true },
    }),
    getCurrentUserPresence(),
  ])

  if (!project) notFound()
  if (!sprint || sprint.projectId !== projectId) notFound()

  // Buscamos la retro más reciente. Si la última está completed, dejamos
  // ver esa misma en readonly. Si quieren una nueva, agregar botón
  // "Nueva retrospectiva" en follow-up.
  const retro = await prisma.retrospective.findFirst({
    where: { sprintId },
    select: {
      id: true,
      title: true,
      notes: true,
      format: true,
      data: true,
      completedAt: true,
      facilitator: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const headerLeft = (
    <Link
      href={`/projects/${project.id}/sprints/${sprint.id}/planning`}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3 w-3" /> {project.name} · {sprint.name}
    </Link>
  )

  if (!retro) {
    return (
      <div className="flex h-full flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
          <div>
            {headerLeft}
            <h1 className="mt-1 text-xl font-bold text-foreground">
              Retrospectiva del sprint
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Captura aprendizajes del equipo en formato estructurado.
            </p>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-8">
          <RetrospectiveSetup
            sprintId={sprint.id}
            sprintName={sprint.name}
            defaultTitle={`Retro · ${sprint.name}`}
            facilitatorId={currentUser?.userId ?? null}
          />
        </div>
      </div>
    )
  }

  const format = retro.format as RetrospectiveFormat
  const normalized = normalizeData(retro.data, format)

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          {headerLeft}
          <h1 className="mt-1 flex items-center gap-2 text-xl font-bold text-foreground">
            {retro.title}
            {retro.completedAt && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Cerrada
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatLabel(format)}
            {retro.facilitator && ` · facilitado por ${retro.facilitator.name}`}
          </p>
        </div>
      </header>

      <RetrospectiveBoard
        retroId={retro.id}
        format={format}
        initialData={normalized}
        completed={!!retro.completedAt}
        currentUserId={currentUser?.userId ?? null}
      />
    </div>
  )
}
