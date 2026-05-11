import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import prisma from '@/lib/prisma'
import { AuditStreamingClient } from '@/components/admin/AuditStreamingClient'

export const dynamic = 'force-dynamic'

/**
 * R3-E · Audit Streaming · Página admin.
 *
 * Lista todos los `AuditStreamTarget` configurados, permite crear/editar/
 * eliminar, ejecutar `test`, y muestra las últimas 20 deliveries con
 * status. Sólo SUPER_ADMIN.
 */
export default async function AuditStreamingPage() {
  await requireSuperAdmin({ path: '/admin/audit-streaming' })

  const [targets, workspaces, recentDeliveries] = await Promise.all([
    prisma.auditStreamTarget.findMany({
      orderBy: { createdAt: 'desc' },
    }),
    prisma.workspace.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    }),
    prisma.auditStreamDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        target: {
          select: { id: true, workspaceId: true, kind: true, endpoint: true },
        },
      },
    }),
  ])

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Audit Streaming SIEM
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reenvía cada evento de auditoría a Splunk HEC, Datadog Logs API o
          un webhook genérico con firma HMAC. Los lotes se entregan cada 5
          min por el cron <code className="rounded bg-subtle px-1 py-0.5 text-[11px]">/api/cron/audit-stream</code>.
        </p>
      </header>

      <AuditStreamingClient
        targets={targets.map((t) => ({
          id: t.id,
          workspaceId: t.workspaceId,
          kind: t.kind,
          endpoint: t.endpoint,
          batchSize: t.batchSize,
          enabled: t.enabled,
          lastDeliveryAt: t.lastDeliveryAt ? t.lastDeliveryAt.toISOString() : null,
          lastError: t.lastError,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        }))}
        workspaces={workspaces}
        recentDeliveries={recentDeliveries.map((d) => ({
          id: d.id,
          targetId: d.targetId,
          targetEndpoint: d.target.endpoint,
          targetKind: d.target.kind,
          workspaceId: d.target.workspaceId,
          batchId: d.batchId,
          count: d.count,
          status: d.status,
          attempt: d.attempt,
          lastError: d.lastError,
          createdAt: d.createdAt.toISOString(),
          deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
        }))}
      />
    </div>
  )
}
