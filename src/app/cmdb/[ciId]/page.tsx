import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Database, Server, Building, User as UserIcon, AlertTriangle } from 'lucide-react'
import { getCIDetail } from '@/lib/actions/cmdb'
import { queryAuditEvents } from '@/lib/actions/audit'
import { CIRelationTree } from '@/components/cmdb/CIRelationTree'
import { ACTION_LABELS } from '@/lib/audit/types'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { hasAdminRole } from '@/lib/auth/permissions'

/**
 * Wave R5 · US-9.3 — CMDB · Detalle de un Configuration Item.
 *
 * Tabs (rendered as anchored sections — no JS necesario):
 *   1. Overview · ficha del CI con atributos custom
 *   2. Relaciones · árbol jerárquico in/out
 *   3. Tickets relacionados · tasks ITIL linkeadas vía TaskCILink
 *   4. Auditoría · últimos eventos audit con entityId === ciId
 */
export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ ciId: string }>
}

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planeado',
  ACTIVE: 'Activo',
  MAINTENANCE: 'Mantenimiento',
  RETIRED: 'Retirado',
  INCIDENT: 'Con incidente',
}

const CRIT_LABEL: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
}

const ROLE_LABEL: Record<string, string> = {
  AFFECTED: 'Afectado',
  CAUSE: 'Causa',
  AFFECTED_DOWNSTREAM: 'Afectado downstream',
  INFORMATIONAL: 'Informativo',
}

export default async function CIDetailPage({ params }: Props) {
  const { ciId } = await params
  let ci
  try {
    ci = await getCIDetail(ciId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[NOT_FOUND]')) {
      notFound()
    }
    throw err
  }

  // Wave R5-Extended — sólo ADMIN+ ve la pestaña "Impacto" (la página
  // protegida con `redirect` igualmente; el link sólo se renderiza para
  // evitar UX rota).
  const viewer = await getCurrentUser()
  const canSeeImpact = !!viewer && hasAdminRole(viewer.roles)

  // Audit del CI (best-effort: si falla, no rompemos la página).
  let auditItems: Awaited<ReturnType<typeof queryAuditEvents>>['items'] = []
  try {
    const audit = await queryAuditEvents({
      entityType: 'configuration_item',
      entityId: ci.id,
      limit: 25,
    })
    auditItems = audit.items
  } catch {
    auditItems = []
  }

  const attributes =
    ci.attributes && typeof ci.attributes === 'object' && !Array.isArray(ci.attributes)
      ? (ci.attributes as Record<string, string | number | boolean>)
      : null

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-start gap-3">
          <Link
            href="/cmdb"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> CMDB
          </Link>
          <div>
            <h1 className="inline-flex items-center gap-2 text-xl font-bold text-foreground">
              <Database className="h-5 w-5 text-emerald-400" />
              <span className="font-mono text-sm text-muted-foreground">
                {ci.code}
              </span>
              <span>· {ci.name}</span>
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {ci.type} · {STATUS_LABEL[ci.status] ?? ci.status} · Criticidad{' '}
              {CRIT_LABEL[ci.criticality] ?? ci.criticality}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[1200px] space-y-8">
          {/* Tabs como anclas para no requerir JS adicional */}
          <nav
            aria-label="Secciones del CI"
            className="flex gap-3 border-b border-border pb-2 text-xs"
          >
            <a href="#overview" className="font-medium text-primary">
              Overview
            </a>
            <a href="#relations" className="text-muted-foreground hover:text-foreground">
              Relaciones ({ci.relationsFrom.length + ci.relationsTo.length})
            </a>
            <a href="#tickets" className="text-muted-foreground hover:text-foreground">
              Tickets ({ci.taskLinks.length})
            </a>
            <a href="#audit" className="text-muted-foreground hover:text-foreground">
              Auditoría ({auditItems.length})
            </a>
            {canSeeImpact ? (
              <Link
                href={`/cmdb/${ci.id}/impact`}
                className="inline-flex items-center gap-1 text-rose-300 hover:text-rose-200"
              >
                <AlertTriangle className="h-3 w-3" /> Impacto
              </Link>
            ) : null}
          </nav>

          {/* Overview */}
          <section id="overview" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Overview
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FieldCard
                icon={<Server className="h-3 w-3" />}
                label="Tipo"
                value={ci.type}
              />
              <FieldCard
                icon={<Database className="h-3 w-3" />}
                label="Estado"
                value={STATUS_LABEL[ci.status] ?? ci.status}
              />
              <FieldCard
                icon={<Database className="h-3 w-3" />}
                label="Criticidad"
                value={CRIT_LABEL[ci.criticality] ?? ci.criticality}
              />
              <FieldCard
                icon={<Building className="h-3 w-3" />}
                label="Ambiente"
                value={ci.environment ?? '—'}
              />
              <FieldCard
                icon={<UserIcon className="h-3 w-3" />}
                label="Dueño"
                value={ci.owner ? `${ci.owner.name}` : 'Sin asignar'}
              />
              <FieldCard
                icon={<UserIcon className="h-3 w-3" />}
                label="Creado por"
                value={ci.createdBy?.name ?? '—'}
              />
              <FieldCard
                icon={<Database className="h-3 w-3" />}
                label="Creado"
                value={new Date(ci.createdAt).toLocaleDateString('es-MX')}
              />
              <FieldCard
                icon={<Database className="h-3 w-3" />}
                label="Retirado"
                value={
                  ci.retiredAt
                    ? new Date(ci.retiredAt).toLocaleDateString('es-MX')
                    : '—'
                }
              />
            </div>

            {ci.description ? (
              <div className="rounded-md border border-border bg-card p-3">
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Descripción
                </h3>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {ci.description}
                </p>
              </div>
            ) : null}

            {attributes && Object.keys(attributes).length > 0 ? (
              <div className="rounded-md border border-border bg-card p-3">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Atributos custom
                </h3>
                <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  {Object.entries(attributes).map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-baseline justify-between gap-2 border-b border-border/40 py-0.5"
                    >
                      <dt className="font-medium text-muted-foreground">{k}</dt>
                      <dd className="text-foreground">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </section>

          {/* Relations */}
          <section id="relations" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Relaciones
            </h2>
            <CIRelationTree
              outbound={ci.relationsFrom.map((r) => ({
                id: r.id,
                kind: r.kind,
                notes: r.notes,
                ci: r.toCI,
              }))}
              inbound={ci.relationsTo.map((r) => ({
                id: r.id,
                kind: r.kind,
                notes: r.notes,
                ci: r.fromCI,
              }))}
            />
          </section>

          {/* Tickets */}
          <section id="tickets" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Tickets relacionados
            </h2>
            {ci.taskLinks.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-subtle/40 p-3 text-xs text-muted-foreground">
                Ningún ticket está vinculado a este CI.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {ci.taskLinks.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                  >
                    <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {link.task.mnemonic ?? link.task.id.slice(0, 6)}
                    </span>
                    <span className="flex-1 truncate text-foreground">
                      {link.task.title}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {link.task.project.name}
                    </span>
                    <span className="rounded border border-border bg-subtle/50 px-1.5 py-0.5 text-[10px]">
                      {ROLE_LABEL[link.role] ?? link.role}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Audit */}
          <section id="audit" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Auditoría
            </h2>
            {auditItems.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-subtle/40 p-3 text-xs text-muted-foreground">
                Sin eventos auditados todavía.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {auditItems.map((evt) => (
                  <li
                    key={evt.id}
                    className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {new Date(evt.createdAt).toLocaleString('es-MX')}
                    </span>
                    <span className="flex-1 text-foreground">
                      {ACTION_LABELS[
                        evt.action as keyof typeof ACTION_LABELS
                      ] ?? evt.action}
                    </span>
                    <span className="text-muted-foreground">
                      {evt.actorName ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function FieldCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  )
}
