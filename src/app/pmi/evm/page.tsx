import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Activity } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function PmiEVMRedirect() {
  const project = await prisma.project.findFirst({
    where: { OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }] },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: { id: true },
  })
  if (project) redirect(`/projects/${project.id}/evm`)

  return (
    <div className="flex h-full flex-col items-center justify-center p-10">
      <div className="max-w-md rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <Activity className="mx-auto h-10 w-10 text-indigo-400" />
        <h2 className="mt-4 text-lg font-semibold text-foreground">
          No hay proyectos activos
        </h2>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Ir a Proyectos
        </Link>
      </div>
    </div>
  )
}
