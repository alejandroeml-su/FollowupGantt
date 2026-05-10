import { Building2 } from 'lucide-react'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import { AdminWorkspacesClient } from '@/components/admin/AdminWorkspacesClient'

export const dynamic = 'force-dynamic'

/**
 * Wave P17-C · CRUD de workspaces desde el panel admin.
 *
 * Lista todos los workspaces (incluyendo archivados) con conteo de
 * proyectos y miembros. La tabla cliente permite crear / editar /
 * archivar (soft delete).
 */
export default async function AdminWorkspacesPage() {
  await requireSuperAdmin({ path: '/admin/workspaces' })

  const workspaces = await prisma.workspace.findMany({
    orderBy: [{ archivedAt: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      plan: true,
      ownerId: true,
      createdAt: true,
      archivedAt: true,
      owner: { select: { name: true, email: true } },
      _count: { select: { members: true, projects: true } },
    },
  })

  // Serializamos las fechas a string para que el cliente no necesite
  // re-hidratar Date (evita issues de SSR/CSR mismatch).
  const initial = workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    description: w.description,
    plan: w.plan,
    ownerName: w.owner?.name ?? null,
    ownerEmail: w.owner?.email ?? null,
    createdAt: w.createdAt.toISOString(),
    archivedAt: w.archivedAt ? w.archivedAt.toISOString() : null,
    memberCount: w._count.members,
    projectCount: w._count.projects,
  }))

  return (
    <div className="p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-indigo-400" />
            Workspaces
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catálogo central de espacios. {initial.length} totales ·{' '}
            {initial.filter((w) => !w.archivedAt).length} activos.
          </p>
        </div>
      </header>

      <AdminWorkspacesClient initialWorkspaces={initial} />
    </div>
  )
}
