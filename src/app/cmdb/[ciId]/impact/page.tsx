import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Database,
  ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'
import { computeImpactCascade, type ImpactNode } from '@/lib/cmdb/impact'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { hasAdminRole } from '@/lib/auth/permissions'

/**
 * Wave R5-Extended · US-9.3E — CMDB · Análisis de impacto
 * ───────────────────────────────────────────────────────────────────
 *
 * Página de solo-lectura que muestra, dado un CI, el árbol de
 * dependientes que se verían afectados si el CI raíz cayera.
 *
 * Acceso: sólo usuarios con rol ADMIN+ (`hasAdminRole`). El CMDB es
 * una vista operativa de ITIL; la cascada de impacto puede revelar
 * topología sensible (qué servicios dependen de qué bases de datos),
 * así que se restringe al equipo de operaciones/admin. Los gerentes
 * de proyecto miran la lista plana de CIs sin la pestaña de impacto.
 *
 * Algoritmo: ver `src/lib/cmdb/impact.ts`. Resumen:
 *   - DFS de profundidad limitada (default 5).
 *   - Anti-ciclo via Set por path.
 *   - Para cada CI afectado, lista tareas vivas (no DONE) vinculadas
 *     vía TaskCILink — permite anticipar el bloqueo operativo.
 *
 * Out of scope (deuda registrada para R5.5+):
 *   - Simulación what-if (marcar CI como DOWN hipotéticamente).
 *   - Disparo de notificaciones cuando el status cambia en BD.
 *   - Diagrama SVG con líneas de relación (lista jerárquica suficiente
 *     hoy, igual que `CIRelationTree`).
 */
export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ ciId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planeado',
  ACTIVE: 'Activo',
  MAINTENANCE: 'Mantenimiento',
  RETIRED: 'Retirado',
  INCIDENT: 'Con incidente',
}

// Colores del badge de estado. Usamos clases con tokens del theme
// (sin `dark:` patterns explícitos — el repo usa CSS variables y
// preferencia documentada en CLAUDE.md).
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  INCIDENT: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  MAINTENANCE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  PLANNED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  RETIRED: 'bg-slate-500/15 text-muted-foreground border-slate-500/30',
}

const CRIT_LABEL: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
}

const CRIT_BADGE: Record<string, string> = {
  LOW: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  MEDIUM: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  HIGH: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  CRITICAL: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
}

const KIND_LABEL: Record<string, string> = {
  DEPENDS_ON: 'depende de',
  RUNS_ON: 'corre sobre',
  USES: 'usa',
  CONTAINS: 'contiene',
  RELATED_TO: 'relacionado con',
}

const ROLE_LABEL: Record<string, string> = {
  AFFECTED: 'Afectado',
  CAUSE: 'Causa',
  AFFECTED_DOWNSTREAM: 'Downstream',
  INFORMATIONAL: 'Informativo',
}

export default async function CIImpactPage({ params, searchParams }: Props) {
  const { ciId } = await params
  const sp = (await searchParams) ?? {}

  // ── Guard ADMIN+ ──────────────────────────────────────────────
  const user = await getCurrentUser()
  if (!user) {
    redirect(`/login?from=/cmdb/${ciId}/impact`)
  }
  if (!hasAdminRole(user.roles)) {
    // Sin rol ADMIN — devolvemos a la ficha plana del CI. Conservamos
    // discoverability del módulo CMDB pero ocultamos el análisis.
    redirect(`/cmdb/${ciId}`)
  }

  // ── Parámetros opcionales ──────────────────────────────────────
  const rawDepth = Array.isArray(sp.depth) ? sp.depth[0] : sp.depth
  const parsedDepth = rawDepth ? Number.parseInt(rawDepth, 10) : NaN
  const maxDepth =
    Number.isFinite(parsedDepth) && parsedDepth > 0 && parsedDepth <= 10
      ? parsedDepth
      : 5

  // ── Cómputo ────────────────────────────────────────────────────
  let result
  try {
    result = await computeImpactCascade(ciId, { maxDepth })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[NOT_FOUND]')) {
      notFound()
    }
    throw err
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-start gap-3">
          <Link
            href={`/cmdb/${ciId}`}
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            <span className="font-mono">{result.root.ci.code}</span>
          </Link>
          <div>
            <h1 className="inline-flex items-center gap-2 text-xl font-bold text-foreground">
              <AlertTriangle className="h-5 w-5 text-rose-400" />
              Análisis de impacto
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cascada de dependientes si <strong>{result.root.ci.name}</strong>{' '}
              fallara · Profundidad máx {maxDepth}
              {result.depthLimitHit ? ' (truncado)' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <SummaryStat label="CIs afectados" value={result.totalAffected} />
          <SummaryStat
            label="Tareas vivas"
            value={result.totalActiveTasks}
            highlight={result.totalActiveTasks > 0}
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[1200px] space-y-6">
          {/* ── Root info ─────────────────────────────────────────── */}
          <section
            aria-label="CI raíz"
            className="rounded-2xl border border-border bg-card/60 p-4"
          >
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-emerald-300" />
              <span className="font-mono text-xs text-muted-foreground">
                {result.root.ci.code}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {result.root.ci.name}
              </span>
              <StatusBadge status={result.root.ci.status} />
              <CritBadge criticality={result.root.ci.criticality} />
            </div>
            {result.root.activeTasks.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Este CI tiene{' '}
                <strong className="text-foreground">
                  {result.root.activeTasks.length}
                </strong>{' '}
                tarea(s) activa(s) en curso.
              </p>
            ) : null}
          </section>

          {/* ── Cascada ───────────────────────────────────────────── */}
          {result.totalAffected === 0 ? (
            <section className="rounded-2xl border border-dashed border-border bg-subtle/30 p-8 text-center">
              <p className="text-sm font-medium text-foreground">
                Ningún CI depende de este.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Si este CI cayera, no se conoce cascada de impacto directa
                según las relaciones registradas en CMDB.
              </p>
            </section>
          ) : (
            <section
              aria-label="Cascada de impacto"
              className="space-y-2"
              data-testid="impact-cascade"
            >
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Cascada ({result.totalAffected})
              </h2>
              <ul className="space-y-1.5">
                {result.root.children.map((child) => (
                  <ImpactRow key={`${child.ci.id}-${child.depth}`} node={child} />
                ))}
              </ul>
            </section>
          )}

          {/* ── Nota algorítmica ─────────────────────────────────── */}
          <section className="rounded-md border border-border/40 bg-subtle/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
            La cascada se calcula recorriendo las relaciones{' '}
            <code className="rounded bg-subtle/60 px-1 py-0.5 font-mono">
              CIRelation
            </code>{' '}
            donde el CI raíz aparece como destino (
            <code className="rounded bg-subtle/60 px-1 py-0.5 font-mono">
              toCI
            </code>
            ). El recorrido se detiene al alcanzar la profundidad máxima o al
            detectar un ciclo en la rama actual. Los CIs retirados quedan
            excluidos. Las tareas listadas excluyen las que están en estado{' '}
            <code className="rounded bg-subtle/60 px-1 py-0.5 font-mono">
              DONE
            </code>{' '}
            o archivadas.
          </section>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────── Helpers de UI ───────────────────────────

function SummaryStat({
  label,
  value,
  highlight,
}: {
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div
      className={clsx(
        'rounded-md border px-3 py-1.5',
        highlight
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          : 'border-border bg-subtle/30 text-foreground',
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-base font-bold leading-tight">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? STATUS_BADGE.PLANNED
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        cls,
      )}
      title={`Estado: ${STATUS_LABEL[status] ?? status}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function CritBadge({ criticality }: { criticality: string }) {
  const cls = CRIT_BADGE[criticality] ?? CRIT_BADGE.MEDIUM
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        cls,
      )}
      title={`Criticidad: ${CRIT_LABEL[criticality] ?? criticality}`}
    >
      {CRIT_LABEL[criticality] ?? criticality}
    </span>
  )
}

/**
 * Fila recursiva del árbol de impacto. Cada nivel se indenta 16px
 * vía `style={{ paddingLeft }}` (Tailwind no genera todas las clases
 * dinámicas `pl-{n}` salvo que estén listadas, así que prefiero el
 * estilo inline calculado a partir de `node.depth`).
 */
function ImpactRow({ node }: { node: ImpactNode }) {
  const isHighStatus =
    node.ci.status === 'INCIDENT' || node.ci.status === 'MAINTENANCE'
  const indentPx = Math.min(node.depth - 1, 6) * 16

  return (
    <li>
      <div
        className={clsx(
          'flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm',
          isHighStatus
            ? 'border-rose-500/30 bg-rose-500/5'
            : 'border-border',
        )}
        style={{ marginLeft: `${indentPx}px` }}
      >
        <ChevronRight
          className="h-3 w-3 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          Nv {node.depth}
        </span>
        <Link
          href={`/cmdb/${node.ci.id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {node.ci.code}
        </Link>
        <span className="truncate font-medium text-foreground">
          {node.ci.name}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {node.ci.type}
        </span>
        <StatusBadge status={node.ci.status} />
        <CritBadge criticality={node.ci.criticality} />
        {node.relationKind ? (
          <span className="ml-auto text-[10px] italic text-muted-foreground">
            via <span className="font-mono">{node.relationKind}</span> (
            {KIND_LABEL[node.relationKind] ?? node.relationKind})
          </span>
        ) : null}
      </div>

      {node.activeTasks.length > 0 ? (
        <div
          className="mt-1 mb-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2"
          style={{ marginLeft: `${indentPx + 16}px` }}
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200/80">
            Tareas activas que podrían bloquearse ({node.activeTasks.length})
          </p>
          <ul className="space-y-0.5">
            {node.activeTasks.map((t) => (
              <li
                key={`${t.id}-${t.role}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="rounded bg-subtle/70 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {t.mnemonic ?? t.id.slice(0, 6)}
                </span>
                <Link
                  href={`/list?taskId=${t.id}`}
                  className="flex-1 truncate text-foreground hover:text-primary hover:underline"
                  title={t.title}
                >
                  {t.title}
                </Link>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t.status}
                </span>
                {t.project ? (
                  <span className="text-[10px] text-muted-foreground">
                    · {t.project.name}
                  </span>
                ) : null}
                <span className="rounded border border-border bg-subtle/60 px-1 py-0.5 text-[10px]">
                  {ROLE_LABEL[t.role] ?? t.role}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {node.children.length > 0 ? (
        <ul className="space-y-1.5">
          {node.children.map((c) => (
            <ImpactRow key={`${c.ci.id}-${c.depth}`} node={c} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
