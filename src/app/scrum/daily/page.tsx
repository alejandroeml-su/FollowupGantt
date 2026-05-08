import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ScrumDailyRedirect() {
  // Buscamos el primer proyecto con sprint ACTIVE.
  const sprint = await prisma.sprint.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { startDate: 'desc' },
    select: { projectId: true },
  })
  if (sprint) redirect(`/projects/${sprint.projectId}/daily-scrum`)

  return (
    <div className="flex h-full flex-col items-center justify-center p-10">
      <div className="max-w-md rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <CalendarClock className="mx-auto h-10 w-10 text-emerald-400" />
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          No hay sprints activos
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Inicia un sprint en cualquier proyecto para registrar Daily Scrums.
        </p>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          Ir a Proyectos
        </Link>
      </div>
    </div>
  )
}
