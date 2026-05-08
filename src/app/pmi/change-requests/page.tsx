import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { GitMerge } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function PmiChangeRequestsRedirect() {
  const project = await prisma.project.findFirst({
    where: { OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }] },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: { id: true },
  })
  if (project) redirect(`/projects/${project.id}/change-requests`)
  return (
    <div className="flex h-full flex-col items-center justify-center p-10">
      <div className="max-w-md rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <GitMerge className="mx-auto h-10 w-10 text-amber-400" />
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          Sin proyecto activo
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Para gestionar Change Requests necesitas al menos un proyecto.
        </p>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-500"
        >
          Ir a Proyectos
        </Link>
      </div>
    </div>
  )
}
