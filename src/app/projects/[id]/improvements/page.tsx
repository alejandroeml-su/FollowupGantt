import Link from 'next/link'
import { ArrowLeft, Lightbulb } from 'lucide-react'
import prisma from '@/lib/prisma'
import { ImprovementsClient } from '@/components/improvements/ImprovementsClient'
import {
  getImprovementMetrics,
  listImprovements,
} from '@/lib/actions/improvements'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function ProjectImprovementsPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, items, metrics, currentUser] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        assignments: {
          select: { user: { select: { id: true, name: true } } },
        },
      },
    }),
    listImprovements({ projectId }),
    getImprovementMetrics({ projectId }),
    getCurrentUserPresence(),
  ])
  if (!project) notFound()

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
            <Lightbulb className="h-5 w-5 text-cyan-400" />
            Improvement Items
          </h1>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <ImprovementsClient
          projectId={project.id}
          projectName={project.name}
          team={team}
          items={items}
          metrics={metrics}
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
