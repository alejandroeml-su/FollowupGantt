import Link from 'next/link'
import { ArrowLeft, Activity } from 'lucide-react'
import prisma from '@/lib/prisma'
import { EVMDashboardClient } from '@/components/evm/EVMDashboardClient'
import { listEVMSnapshots } from '@/lib/actions/evm-snapshots'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function ProjectEVMPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, snapshots, currentUser] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        budget: true,
        budgetCurrency: true,
      },
    }),
    listEVMSnapshots({ projectId }),
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
            <Activity className="h-5 w-5 text-indigo-400" />
            EVM · Curva S
          </h1>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <EVMDashboardClient
          projectId={project.id}
          projectName={project.name}
          budget={project.budget ? Number(project.budget) : null}
          currency={project.budgetCurrency || 'USD'}
          snapshots={snapshots}
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
