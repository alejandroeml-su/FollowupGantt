import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'

/**
 * Wave P18-A — atajo global desde el Sidebar (grupo PMI).
 * Redirige al `/projects/{activeProject}/quality`.
 */
export const dynamic = 'force-dynamic'

export default async function PmiQualityRedirect() {
  const project = await prisma.project.findFirst({
    where: { OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }] },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: { id: true },
  })
  if (project) redirect(`/projects/${project.id}/quality`)
  return (
    <div className="flex h-full flex-col items-center justify-center p-10">
      <div className="max-w-md rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-emerald-400" />
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          Sin proyecto activo
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Para gestionar inspecciones de calidad necesitas al menos un proyecto
          en estado ACTIVE o PLANNING.
        </p>
        <Link
          href="/projects"
          className="mt-4 inline-block rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Ir a proyectos
        </Link>
      </div>
    </div>
  )
}
