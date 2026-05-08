import Link from 'next/link'
import { ArrowLeft, GitMerge } from 'lucide-react'
import prisma from '@/lib/prisma'
import { listChangeRequests } from '@/lib/actions/change-requests'
import { ChangeRequestsClient } from '@/components/change-requests/ChangeRequestsClient'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function ChangeRequestsPage({ params }: PageProps) {
  const { id: projectId } = await params
  const [project, requests, currentUser] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    listChangeRequests(projectId),
    getCurrentUserPresence(),
  ])
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
            <GitMerge className="h-5 w-5 text-amber-400" />
            Change Control Board
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PMBOK · Perform Integrated Change Control
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <ChangeRequestsClient
          projectId={project.id}
          currentUserId={currentUser?.userId ?? null}
          changeRequests={requests}
        />
      </div>
    </div>
  )
}
