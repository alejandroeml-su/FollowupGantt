'use client'

/**
 * Wave R5 · US-9.3 — CMDB · Tree view jerárquico de relaciones.
 *
 * Renderiza dos columnas con las relaciones outbound (este CI →) y
 * inbound (← otros CIs), agrupadas por `kind`. Es deliberadamente una
 * lista jerárquica plana (no SVG con líneas) porque:
 *
 *   1. El modelo permite ciclos largos via grafo (A → B → C → A) y un
 *      SVG layout interactivo entra en deuda de R5.5; por ahora la
 *      lista es suficiente para que un Gestor de Servicios entienda el
 *      impacto downstream.
 *   2. La lista es accesible por teclado y screen readers sin esfuerzo
 *      extra (ul/li nested vs canvas tab traps).
 *
 * Si la deuda crece, migrar a `react-flow` o `@xyflow/react`.
 */

import Link from 'next/link'
import {
  ArrowRight,
  ArrowLeft,
  Network,
  GitBranch,
  Cpu,
  HardDrive,
  Layers,
} from 'lucide-react'
import { clsx } from 'clsx'

type RelatedCI = {
  id: string
  code: string
  name: string
  type: string
  status: string
  criticality: string
}

type Relation = {
  id: string
  kind: string
  notes: string | null
  ci: RelatedCI
}

type Props = {
  /** Relaciones outbound desde este CI hacia otros (este → otro). */
  outbound: Relation[]
  /** Relaciones inbound (otros CIs apuntando a este). */
  inbound: Relation[]
}

const KIND_LABEL: Record<string, string> = {
  DEPENDS_ON: 'Depende de',
  RUNS_ON: 'Corre sobre',
  USES: 'Usa',
  CONTAINS: 'Contiene',
  RELATED_TO: 'Relacionado con',
}

const KIND_ICON: Record<string, typeof GitBranch> = {
  DEPENDS_ON: GitBranch,
  RUNS_ON: Cpu,
  USES: Network,
  CONTAINS: Layers,
  RELATED_TO: HardDrive,
}

const CRIT_COLOR: Record<string, string> = {
  LOW: 'text-emerald-300',
  MEDIUM: 'text-amber-300',
  HIGH: 'text-orange-300',
  CRITICAL: 'text-rose-300',
}

function groupByKind(list: Relation[]): Record<string, Relation[]> {
  const out: Record<string, Relation[]> = {}
  for (const r of list) {
    if (!out[r.kind]) out[r.kind] = []
    out[r.kind].push(r)
  }
  return out
}

function RelationList({
  items,
  direction,
}: {
  items: Relation[]
  direction: 'out' | 'in'
}) {
  const grouped = groupByKind(items)
  const kinds = Object.keys(grouped)
  if (kinds.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-subtle/40 p-3 text-xs text-muted-foreground">
        Sin relaciones {direction === 'out' ? 'salientes' : 'entrantes'}.
      </p>
    )
  }
  return (
    <ul className="space-y-3">
      {kinds.map((kind) => {
        const Icon = KIND_ICON[kind] ?? GitBranch
        return (
          <li key={kind}>
            <h4 className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Icon className="h-3 w-3" /> {KIND_LABEL[kind] ?? kind}
            </h4>
            <ul className="space-y-1">
              {grouped[kind].map((rel) => (
                <li
                  key={rel.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-subtle/30 px-2 py-1.5 text-xs"
                >
                  {direction === 'out' ? (
                    <ArrowRight
                      className="h-3 w-3 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowLeft
                      className="h-3 w-3 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <Link
                    href={`/cmdb/${rel.ci.id}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {rel.ci.code}
                  </Link>
                  <span className="truncate text-foreground">
                    {rel.ci.name}
                  </span>
                  <span
                    className={clsx(
                      'ml-auto text-[10px]',
                      CRIT_COLOR[rel.ci.criticality] ?? 'text-muted-foreground',
                    )}
                    title={`Criticidad ${rel.ci.criticality}`}
                  >
                    {rel.ci.criticality}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

export function CIRelationTree({ outbound, inbound }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="ci-relation-tree">
      <section aria-label="Relaciones salientes">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sale hacia ({outbound.length})
        </h3>
        <RelationList items={outbound} direction="out" />
      </section>
      <section aria-label="Relaciones entrantes">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Entra desde ({inbound.length})
        </h3>
        <RelationList items={inbound} direction="in" />
      </section>
    </div>
  )
}
