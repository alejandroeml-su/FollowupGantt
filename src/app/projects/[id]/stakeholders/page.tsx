import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import prisma from '@/lib/prisma'
import { listStakeholders } from '@/lib/actions/stakeholders'
import { StakeholderRegisterClient } from '@/components/stakeholders/StakeholderRegisterClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function StakeholdersPage({ params }: PageProps) {
  const { id: projectId } = await params
  const [project, stakeholders] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    listStakeholders(projectId),
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
            <Users className="h-5 w-5 text-indigo-400" />
            Stakeholder Register
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PMBOK · Stakeholder Engagement Plan + matriz Mendelow
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <StakeholderRegisterClient
          projectId={project.id}
          projectName={project.name}
          stakeholders={stakeholders}
        />
      </div>
    </div>
  )
}
