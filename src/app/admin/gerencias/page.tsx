import { Layers } from 'lucide-react'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import { AdminGerenciasClient } from '@/components/admin/AdminGerenciasClient'

export const dynamic = 'force-dynamic'

/**
 * Wave P17-C · Lista de gerencias del panel admin con conteo de áreas.
 * El detalle (CRUD de áreas por gerencia) vive en
 * `/admin/gerencias/[id]`.
 */
export default async function AdminGerenciasPage() {
  await requireSuperAdmin({ path: '/admin/gerencias' })

  const gerencias = await prisma.gerencia.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      _count: { select: { areas: true } },
      areas: {
        select: {
          _count: {
            select: {
              projects: true,
            },
          },
        },
      },
    },
  })

  const initial = gerencias.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    createdAt: g.createdAt.toISOString(),
    areaCount: g._count.areas,
    projectCount: g.areas.reduce((acc, a) => acc + a._count.projects, 0),
  }))

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Layers className="h-6 w-6 text-emerald-400" />
          Gerencias
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Estructura organizacional. {initial.length} gerencia(s) ·{' '}
          {initial.reduce((acc, g) => acc + g.areaCount, 0)} área(s) totales.
        </p>
      </header>

      <AdminGerenciasClient initial={initial} />
    </div>
  )
}
