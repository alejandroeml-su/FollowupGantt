import Link from 'next/link'
import { ArrowLeft, ClipboardCheck } from 'lucide-react'
import { getSprintReviewData } from '@/lib/actions/sprint-review'
import { SprintReviewClient } from '@/components/sprint-review/SprintReviewClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string; sprintId: string }>
}

export default async function SprintReviewPage({ params }: PageProps) {
  const { id: projectId, sprintId } = await params

  let data
  try {
    data = await getSprintReviewData(sprintId)
  } catch {
    notFound()
  }
  if (data.project.id !== projectId) notFound()

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href={`/projects/${data.project.id}/sprints/${data.sprint.id}/planning`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> {data.project.name} ·{' '}
            {data.sprint.name}
          </Link>
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <ClipboardCheck className="h-5 w-5 text-emerald-400" />
            Sprint Review
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Inspección formal del Increment con stakeholders · Scrum Guide 2020
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <SprintReviewClient data={data} />
      </div>
    </div>
  )
}
