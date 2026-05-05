'use client'

/**
 * Wave P8 · Equipo P8-2 — Matriz interactiva 5×5 de probability × impact.
 *
 * Renderiza un grid 5×5 donde:
 *   - Filas (top→bottom): probability 5 → 1.
 *   - Columnas (left→right): impact 1 → 5.
 *   - Cada celda muestra el conteo de risks en esa intersección.
 *   - Color: verde (LOW) → amarillo → naranja → rojo (CRITICAL).
 *
 * Click en una celda emite el filtro `{ probability, impact }` al padre
 * para filtrar `RiskRegisterTable`. Click en la celda activa la deselecciona
 * (toggle).
 *
 * Accesibilidad:
 *   - Cada celda es un `button` con `aria-pressed` y `aria-label` legible.
 *   - El estado seleccionado se marca con `data-selected` para tests.
 */

import { useMemo } from 'react'
import {
  IMPACT_LABEL,
  IMPACT_LEVELS,
  PROBABILITY_LABEL,
  PROBABILITY_LEVELS,
  TIER_LABEL,
  type ImpactLevel,
  type ProbabilityLevel,
  type SerializedRisk,
} from '@/lib/risks/types'
import {
  TIER_BG_CLASS,
  TIER_BORDER_CLASS,
  TIER_TEXT_CLASS,
  evaluateRisk,
} from '@/lib/risks/risk-score'

export type MatrixCellSelection = {
  probability: ProbabilityLevel
  impact: ImpactLevel
} | null

type Props = {
  risks: SerializedRisk[]
  selected?: MatrixCellSelection
  onSelectCell?: (selection: MatrixCellSelection) => void
}

export function RiskMatrix({ risks, selected, onSelectCell }: Props) {
  // Pre-agrupar conteos por celda (probability, impact) en O(N).
  const cellCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of risks) {
      // Sólo contamos los activos (no CLOSED) para que la matriz refleje
      // el riesgo vivo del proyecto. Caller puede filtrar antes si quiere
      // todos.
      if (r.status === 'CLOSED') continue
      const key = `${r.probability}|${r.impact}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [risks])

  // Filas top→bottom: probability 5 → 1 (alta arriba).
  const rows = [...PROBABILITY_LEVELS].reverse()

  return (
    <div
      className="rounded-lg border border-border bg-card p-3"
      data-testid="risk-matrix"
    >
      <h3 className="mb-2 text-sm font-semibold">
        Matriz Probabilidad × Impacto
      </h3>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: 'auto repeat(5, 1fr)' }}
      >
        {/* Header: corner + impact labels */}
        <div aria-hidden />
        {IMPACT_LEVELS.map((i) => (
          <div
            key={`hdr-impact-${i}`}
            className="text-center text-[10px] font-medium text-muted-foreground"
          >
            {i}. {IMPACT_LABEL[i]}
          </div>
        ))}

        {/* Filas */}
        {rows.map((p) => (
          <RowFragment
            key={`row-${p}`}
            probability={p}
            cellCounts={cellCounts}
            selected={selected ?? null}
            onSelectCell={onSelectCell}
          />
        ))}
      </div>

      {/* Leyenda de tiers */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
        <span className="text-muted-foreground">Severidad:</span>
        {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span
              className={`inline-block h-3 w-3 rounded ${TIER_BG_CLASS[t]} border ${TIER_BORDER_CLASS[t]}`}
              aria-hidden
            />
            <span className={TIER_TEXT_CLASS[t]}>{TIER_LABEL[t]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function RowFragment({
  probability,
  cellCounts,
  selected,
  onSelectCell,
}: {
  probability: ProbabilityLevel
  cellCounts: Map<string, number>
  selected: MatrixCellSelection
  onSelectCell: ((s: MatrixCellSelection) => void) | undefined
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-1 text-[10px] font-medium text-muted-foreground">
        {probability}. {PROBABILITY_LABEL[probability]}
      </div>
      {IMPACT_LEVELS.map((impact) => {
        const count = cellCounts.get(`${probability}|${impact}`) ?? 0
        const { tier } = evaluateRisk(probability, impact)
        const isSelected =
          selected?.probability === probability &&
          selected?.impact === impact
        return (
          <button
            type="button"
            key={`cell-${probability}-${impact}`}
            data-testid={`matrix-cell-${probability}-${impact}`}
            data-tier={tier}
            data-selected={isSelected ? 'true' : 'false'}
            aria-pressed={isSelected}
            aria-label={`Probabilidad ${probability}, Impacto ${impact}, ${TIER_LABEL[tier]}, ${count} riesgos`}
            onClick={() => {
              if (!onSelectCell) return
              onSelectCell(isSelected ? null : { probability, impact })
            }}
            className={[
              'group relative aspect-square rounded border transition-all',
              TIER_BG_CLASS[tier],
              TIER_BORDER_CLASS[tier],
              isSelected ? 'ring-2 ring-primary ring-offset-1' : 'hover:opacity-80',
            ].join(' ')}
          >
            <span
              className={`text-base font-semibold ${TIER_TEXT_CLASS[tier]}`}
            >
              {count}
            </span>
            <span className="sr-only">
              P{probability} × I{impact} = {probability * impact}
            </span>
          </button>
        )
      })}
    </>
  )
}
