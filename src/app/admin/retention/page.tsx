import { ShieldAlert } from 'lucide-react'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import { ensureDefaultPolicies } from '@/lib/retention/defaults'
import { RetentionPoliciesClient } from '@/components/admin/RetentionPoliciesClient'
import type {
  SerializedPolicy,
  SerializedPurgeRun,
} from '@/lib/actions/retention'

export const dynamic = 'force-dynamic'

/**
 * R3.0-F · Data Retention Policies — Página admin.
 *
 * Lista las 4 policies del workspace activo y permite:
 *   - editar `retainDays` y `enabled` por dominio
 *   - disparar "Run now" manual (con confirm dialog)
 *   - ver historial de últimas 10 runs
 *
 * Resolución de workspace: prioriza la cookie `x-active-workspace`. Si
 * no hay (raro para SUPER_ADMIN), cae al primer workspace existente
 * ordenado por createdAt — el SUPER_ADMIN siempre tendrá al menos uno.
 */
export default async function AdminRetentionPage() {
  await requireSuperAdmin({ path: '/admin/retention' })

  const cookieStore = await cookies()
  const activeWorkspaceCookie = cookieStore.get('x-active-workspace')?.value

  let workspace = activeWorkspaceCookie
    ? await prisma.workspace.findUnique({
        where: { id: activeWorkspaceCookie },
        select: { id: true, name: true, slug: true },
      })
    : null

  if (!workspace) {
    workspace = await prisma.workspace.findFirst({
      where: { archivedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, slug: true },
    })
  }

  if (!workspace) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">
          No hay workspaces activos en el sistema.
        </p>
      </div>
    )
  }

  await ensureDefaultPolicies(workspace.id).catch(() => undefined)

  const [rows, runs] = await Promise.all([
    prisma.retentionPolicy.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { domain: 'asc' },
    }),
    prisma.retentionPurgeRun.findMany({
      where: { policy: { workspaceId: workspace.id } },
      include: { policy: { select: { domain: true } } },
      orderBy: { startedAt: 'desc' },
      take: 10,
    }),
  ])

  const initialPolicies: SerializedPolicy[] = rows.map((p) => ({
    id: p.id,
    workspaceId: p.workspaceId,
    domain: p.domain,
    retainDays: p.retainDays,
    enabled: p.enabled,
    lastPurgeAt: p.lastPurgeAt ? p.lastPurgeAt.toISOString() : null,
    lastPurgeCount: p.lastPurgeCount,
    updatedAt: p.updatedAt.toISOString(),
  }))

  const initialHistory: SerializedPurgeRun[] = runs.map((r) => ({
    id: r.id,
    policyId: r.policyId,
    domain: r.policy.domain,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    deletedCount: r.deletedCount,
    status: r.status,
    errorMessage: r.errorMessage,
  }))

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-rose-400" />
          Data Retention Policies
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace activo:{' '}
          <span className="font-mono text-foreground/90">{workspace.slug}</span>{' '}
          · Configura cuántos días se conservan los datos antes de purge
          automático.
        </p>
        <p className="mt-1 text-xs text-amber-400">
          El cron de purge corre diariamente a las 03:00 UTC. Validá los
          valores antes de habilitarlo en producción — borra datos.
        </p>
      </header>

      <RetentionPoliciesClient
        workspaceId={workspace.id}
        workspaceSlug={workspace.slug}
        initialPolicies={initialPolicies}
        initialHistory={initialHistory}
      />
    </div>
  )
}
