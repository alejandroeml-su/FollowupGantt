import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileUp } from 'lucide-react'
import prisma from '@/lib/prisma'
import { MigrateCsvClient } from '@/components/migrate/MigrateCsvClient'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function ProjectMigratePage({ params }: PageProps) {
  const { id: projectId } = await params

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) notFound()

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
            <FileUp className="h-5 w-5 text-emerald-400" />
            Migration Assistant
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Importa tareas desde un CSV exportado de Jira, Trello, ClickUp u otra herramienta.
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <MigrateCsvClient projectId={project.id} projectName={project.name} />
      </div>
    </div>
  )
}
