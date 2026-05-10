import Link from 'next/link'
import { ArrowLeft, Layers } from 'lucide-react'
import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import { AdminAreasClient } from '@/components/admin/AdminAreasClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

/**
 * Wave P17-C · Detalle de gerencia: lista + CRUD de áreas asociadas.
 * Bloquea el delete de un área con proyectos activos (server action lo
 * valida con error tipado [HAS_PROJECTS]).
 */
export default async function AdminGerenciaDetailPage({ params }: PageProps) {
  await requireSuperAdmin({ path: '/admin/gerencias/[id]' })

  const { id } = await params

  const gerencia = await prisma.gerencia.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      areas: {
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          _count: { select: { projects: true } },
        },
      },
    },
  })

  if (!gerencia) notFound()

  const initial = gerencia.areas.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    createdAt: a.createdAt.toISOString(),
    projectCount: a._count.projects,
  }))

  return (
    <div className="p-8">
      <header className="mb-6">
        <Link
          href="/admin/gerencias"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a gerencias
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Layers className="h-6 w-6 text-emerald-400" />
          {gerencia.name}
        </h1>
        {gerencia.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {gerencia.description}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {initial.length} área(s) asociadas.
        </p>
      </header>

      <AdminAreasClient gerenciaId={gerencia.id} initial={initial} />
    </div>
  )
}
