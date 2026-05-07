'use client'

/**
 * Wave P10 (HU-10.5 · ALPHA-2.2) — Matriz de riesgos PMBOK 5×5.
 *
 * Cada celda: count de riesgos abiertos con esa (probability, impact).
 * Color por severity derivada (P×I): LOW < 6, MEDIUM 6-11, HIGH ≥ 12.
 *
 * Eje X = impact (1-5), Eje Y = probability (5-1, descendente).
 */

import type { RiskMatrixCell, RiskSeverity } from '@/lib/portfolio/risks'

const SEV_BG: Record<RiskSeverity, string> = {
  LOW: 'bg-emerald-500/15 border-emerald-500/30',
  MEDIUM: 'bg-amber-500/15 border-amber-500/40',
  HIGH: 'bg-rose-500/20 border-rose-500/50',
}

const SEV_TEXT: Record<RiskSeverity, string> = {
  LOW: 'text-emerald-300',
  MEDIUM: 'text-amber-300',
  HIGH: 'text-rose-300',
}

const PROB_LABEL = ['', 'Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta']
const IMPACT_LABEL = ['', 'Insignif.', 'Menor', 'Moderado', 'Mayor', 'Severo']

type Props = {
  matrix: RiskMatrixCell[]
}

export function RiskMatrix({ matrix }: Props) {
  // Re-organizar por probability descendente (5 arriba) × impact ascendente.
  const grid: Record<number, Record<number, RiskMatrixCell>> = {}
  for (const c of matrix) {
    if (!grid[c.probability]) grid[c.probability] = {}
    grid[c.probability][c.impact] = c
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Matriz probabilidad × impacto
      </h3>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: 'auto repeat(5, minmax(0, 1fr))' }}
      >
        {/* Header impacto */}
        <div />
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={`hdr-imp-${i}`}
            className="text-center text-[10px] font-semibold text-muted-foreground"
          >
            {i} · {IMPACT_LABEL[i]}
          </div>
        ))}

        {/* Filas: probability 5 → 1 */}
        {[5, 4, 3, 2, 1].map((p) => (
          <FragmentRow key={`row-${p}`} p={p} grid={grid} />
        ))}
      </div>

      {/* Leyenda */}
      <div className="mt-3 flex items-center justify-end gap-3 text-[10px]">
        <span className="inline-flex items-center gap-1">
          <span className={`h-3 w-3 rounded border ${SEV_BG.LOW}`} /> Bajo
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={`h-3 w-3 rounded border ${SEV_BG.MEDIUM}`} /> Medio
        </span>
        <span className="inline-flex items-center gap-1">
          <span className={`h-3 w-3 rounded border ${SEV_BG.HIGH}`} /> Alto
        </span>
      </div>
    </div>
  )
}

function FragmentRow({
  p,
  grid,
}: {
  p: number
  grid: Record<number, Record<number, RiskMatrixCell>>
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-2 text-[10px] font-semibold text-muted-foreground">
        {p} · {PROB_LABEL[p]}
      </div>
      {[1, 2, 3, 4, 5].map((i) => {
        const cell = grid[p]?.[i]
        if (!cell) return <div key={`empty-${p}-${i}`} />
        const empty = cell.count === 0
        return (
          <div
            key={`cell-${p}-${i}`}
            className={`flex h-12 items-center justify-center rounded border text-sm font-bold ${SEV_BG[cell.severity]} ${empty ? 'opacity-30' : ''} ${SEV_TEXT[cell.severity]}`}
            title={`P${p} × I${i} = ${p * i} (${cell.severity}) — ${cell.count} riesgo${cell.count === 1 ? '' : 's'}`}
          >
            {empty ? '·' : cell.count}
          </div>
        )
      })}
    </>
  )
}
