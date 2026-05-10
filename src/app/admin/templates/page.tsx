import { FileStack } from 'lucide-react'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import { AdminTemplatesClient } from '@/components/admin/AdminTemplatesClient'

export const dynamic = 'force-dynamic'

/**
 * Wave P17-C · Plantillas globales — CRUD + aplicar a workspace.
 *
 * Las plantillas con `workspaceId=null` son del catálogo central. Las
 * que tienen `workspaceId` set son clones aplicados a un WS específico
 * (no editables desde aquí — sólo deletable).
 */
export default async function AdminTemplatesPage() {
  await requireSuperAdmin({ path: '/admin/templates' })

  const [templates, workspaces] = await Promise.all([
    prisma.globalTemplate.findMany({
      orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        kind: true,
        workspaceId: true,
        createdAt: true,
        updatedAt: true,
        payload: true,
        workspace: { select: { name: true, slug: true } },
        createdBy: { select: { name: true, email: true } },
      },
    }),
    prisma.workspace.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
  ])

  const initial = templates.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    workspaceId: t.workspaceId,
    workspaceName: t.workspace?.name ?? null,
    workspaceSlug: t.workspace?.slug ?? null,
    payload: t.payload as Record<string, unknown>,
    createdByName: t.createdBy?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }))

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <FileStack className="h-6 w-6 text-cyan-400" />
          Plantillas globales
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Catálogo central. Una plantilla con workspace NULL está disponible
          a todos los workspaces; al aplicarla se clona al destino.
        </p>
      </header>

      <AdminTemplatesClient initial={initial} workspaces={workspaces} />
    </div>
  )
}
