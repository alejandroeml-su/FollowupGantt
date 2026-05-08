import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import prisma from '@/lib/prisma'
import { loadProjectChecklists } from '@/lib/actions/dor-dod'
import { ChecklistsPanel } from '@/components/dor-dod/ChecklistsPanel'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProjectDefinitionsPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, checklists] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    loadProjectChecklists(projectId),
  ])

  if (!project) notFound()

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href={`/projects/${project.id}/epics`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> {project.name}
          </Link>
          <h1 className="mt-1 text-xl font-bold text-foreground">
            Definitions of Ready &amp; Done
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Plantillas culturales que sirven como guía al mover Stories de
            estado. Validación SOFT (toast informativo, no bloqueante).
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <ChecklistsPanel
          projectId={project.id}
          projectName={project.name}
          dor={checklists.dor}
          dod={checklists.dod}
        />
      </div>
    </div>
  )
}
