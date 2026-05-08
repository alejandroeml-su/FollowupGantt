import Link from 'next/link'
import { ArrowLeft, Target } from 'lucide-react'
import prisma from '@/lib/prisma'
import { ProductGoalEditor } from '@/components/product-goal/ProductGoalEditor'
import { normalizeProductGoal } from '@/lib/product-goal/types'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProductGoalPage({ params }: PageProps) {
  const { id: projectId } = await params

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, productGoal: true },
  })
  if (!project) notFound()

  const goal = normalizeProductGoal(project.productGoal)

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
            <Target className="h-5 w-5 text-indigo-400" />
            Product Goal
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Commitment del Product Backlog · responsabilidad del Product Owner
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <ProductGoalEditor
          projectId={project.id}
          projectName={project.name}
          initial={goal}
        />
      </div>
    </div>
  )
}
