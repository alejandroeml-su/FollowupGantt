import Link from 'next/link'
import { ArrowLeft, FileText } from 'lucide-react'
import prisma from '@/lib/prisma'
import { CharterEditor } from '@/components/charter/CharterEditor'
import { normalizeCharter } from '@/lib/charter/types'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function CharterPage({ params }: PageProps) {
  const { id: projectId } = await params
  const [project, currentUser] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, charter: true },
    }),
    getCurrentUserPresence(),
  ])
  if (!project) notFound()
  const charter = normalizeCharter(project.charter)

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
            <FileText className="h-5 w-5 text-violet-400" />
            Project Charter
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PMBOK · Develop Project Charter (Integration Management)
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <CharterEditor
          projectId={project.id}
          projectName={project.name}
          initial={charter}
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
