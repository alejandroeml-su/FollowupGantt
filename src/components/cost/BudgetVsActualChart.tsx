'use client'

/**
 * Ola P8 · Equipo P8-3 · Cost Management — Chart Budget vs Actual.
 *
 * Renderiza barras horizontales por scope (project/phase/sprint) mostrando
 * presupuesto en USD vs gasto real (suma `amountUsd` aprobado/reembolsado).
 * Los scopes se agrupan por tipo en secciones colapsables (project,
 * phase, sprint).
 *
 * Implementación con divs CSS (sin librería de charting) — alineado con la
 * decisión D-Performance del repo: minimizar bundle. Si el dashboard
 * crece a > 50 scopes, considerar migrar a recharts en P8-5.
 */

import type { BudgetVsActualRow } from '@/lib/actions/budgets'

export type BudgetVsActualChartProps = {
  rows: BudgetVsActualRow[]
}

const TYPE_LABEL: Record<BudgetVsActualRow['scopeType'], string> = {
  project: 'Proyecto',
  phase: 'Fase',
  sprint: 'Sprint',
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Devuelve color de la barra basado en utilization.
 * <75%: emerald, 75-90%: amber, >90%: red.
 */
function utilColor(util: number | null): string {
  if (util === null) return 'bg-muted'
  if (util < 0.75) return 'bg-emerald-500'
  if (util < 0.9) return 'bg-amber-500'
  return 'bg-red-500'
}

export function BudgetVsActualChart(props: BudgetVsActualChartProps) {
  const { rows } = props
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Aún no hay presupuestos definidos.
      </div>
    )
  }

  const grouped: Record<BudgetVsActualRow['scopeType'], BudgetVsActualRow[]> = {
    project: [],
    phase: [],
    sprint: [],
  }
  for (const r of rows) {
    grouped[r.scopeType].push(r)
  }

  return (
    <div className="space-y-4" aria-label="Presupuesto vs gasto real">
      {(['project', 'phase', 'sprint'] as const).map((type) => {
        const list = grouped[type]
        if (list.length === 0) return null
        return (
          <section
            key={type}
            className="rounded border border-border bg-card p-3"
            aria-label={TYPE_LABEL[type]}
          >
            <h3 className="mb-2 text-sm font-semibold">{TYPE_LABEL[type]}</h3>
            <ul className="space-y-2">
              {list.map((r) => (
                <li key={r.scopeId}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{r.scopeName}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatUsd(r.actualUsd)} /{' '}
                      {r.budgetUsd === null ? 'sin presupuesto' : formatUsd(r.budgetUsd)}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={r.utilization === null ? 0 : Math.min(100, r.utilization * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className={`h-full transition-all ${utilColor(r.utilization)}`}
                      style={{
                        width:
                          r.utilization === null
                            ? '0%'
                            : `${Math.min(100, r.utilization * 100).toFixed(1)}%`,
                      }}
                    />
                  </div>
                  {r.utilization !== null && (
                    <span className="text-[10px] text-muted-foreground">
                      {(r.utilization * 100).toFixed(1)}% consumido
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
