import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ScrumImpedimentsRedirect() {
  const sprint = await prisma.sprint.findFirst({
    where: { status: { in: ['ACTIVE', 'PLANNING'] } },
    orderBy: { startDate: 'desc' },
    select: { projectId: true },
  })
  if (sprint) redirect(`/projects/${sprint.projectId}/impediments`)

  return (
    <div className="flex h-full flex-col items-center justify-center p-10">
      <div className="max-w-md rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-orange-400" />
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          No hay sprints donde rastrear impediments
        </h2>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-500"
        >
          Ir a Proyectos
        </Link>
      </div>
    </div>
  )
}
