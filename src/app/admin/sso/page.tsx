import { KeyRound } from 'lucide-react'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import { SsoProviderClient } from '@/components/admin/SsoProviderClient'

export const dynamic = 'force-dynamic'

/**
 * R3.0 · Fase 2 · SSO/SAML — Página admin de proveedores SAML.
 *
 * Lista los providers de todos los workspaces (SUPER_ADMIN ve global) y
 * permite CRUD vía el cliente. Para iterar UX a futuro, el switcher de
 * workspace se hace inline en el form (no en el filtro global).
 */
export default async function AdminSsoPage() {
  await requireSuperAdmin({ path: '/admin/sso' })

  const [providers, workspaces] = await Promise.all([
    prisma.ssoProvider.findMany({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        workspaceId: true,
        name: true,
        kind: true,
        entityId: true,
        ssoUrl: true,
        x509Cert: true,
        attributeMap: true,
        enabled: true,
        createdAt: true,
        workspace: { select: { id: true, name: true, slug: true } },
        _count: { select: { links: true } },
      },
    }),
    prisma.workspace.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
  ])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const initial = providers.map((p) => ({
    id: p.id,
    workspaceId: p.workspaceId,
    workspaceName: p.workspace?.name ?? '—',
    workspaceSlug: p.workspace?.slug ?? '',
    name: p.name,
    kind: p.kind,
    entityId: p.entityId,
    ssoUrl: p.ssoUrl,
    x509Cert: p.x509Cert,
    attributeMap: p.attributeMap as unknown as Record<string, unknown>,
    enabled: p.enabled,
    linkCount: p._count.links,
    createdAt: p.createdAt.toISOString(),
    spEntityId: `${appUrl}/api/auth/sso/${p.id}`,
    acsUrl: `${appUrl}/api/auth/sso/${p.id}/acs`,
    loginUrl: `${appUrl}/api/auth/sso/${p.id}/login`,
  }))

  return (
    <div className="p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <KeyRound className="h-6 w-6 text-indigo-400" />
            SSO / SAML
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Identidad federada por workspace ·{' '}
            {initial.length} proveedores · {initial.filter((p) => p.enabled).length} activos.
          </p>
        </div>
      </header>

      <SsoProviderClient initialProviders={initial} workspaces={workspaces} />
    </div>
  )
}
