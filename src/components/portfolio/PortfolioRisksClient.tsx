'use client'

/**
 * Wave P14c follow-up — Wrapper client de /portfolio/risks que une la
 * matriz 5×5 y la lista detallada con un filtro compartido por celda.
 *
 * Click en una celda de la matriz → filtra la lista a los riesgos con
 * exactamente esa (probability, impact). Click de nuevo en la misma celda
 * o en "Limpiar filtro" → muestra todos los riesgos.
 *
 * El estado vive en el cliente para evitar round-trip al server por cada
 * click (la matrix y la lista ya tienen TODOS los items pre-cargados).
 */

import { useState } from 'react'
import { X as ClearIcon } from 'lucide-react'
import type {
  ConsolidatedRiskItem,
  RiskMatrixCell,
} from '@/lib/portfolio/risks'
import { RiskMatrix } from './RiskMatrix'
import { ConsolidatedRiskList } from './ConsolidatedRiskList'

interface Props {
  items: ConsolidatedRiskItem[]
  matrix: RiskMatrixCell[]
}

export interface SelectedCell {
  probability: number
  impact: number
}

const PROB_LABEL = ['', 'Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta']
const IMPACT_LABEL = ['', 'Insignif.', 'Menor', 'Moderado', 'Mayor', 'Severo']

export function PortfolioRisksClient({ items, matrix }: Props): React.JSX.Element {
  const [selected, setSelected] = useState<SelectedCell | null>(null)

  const handleCellClick = (p: number, i: number) => {
    if (selected?.probability === p && selected?.impact === i) {
      // Click en la misma celda → toggle off
      setSelected(null)
      return
    }
    setSelected({ probability: p, impact: i })
  }

  const filtered = selected
    ? items.filter(
        (r) =>
          r.probability === selected.probability &&
          r.impact === selected.impact,
      )
    : items

  return (
    <>
      <RiskMatrix
        matrix={matrix}
        selectedCell={selected}
        onCellClick={handleCellClick}
      />

      {selected && (
        <div className="flex items-center justify-between rounded-md border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm">
          <div className="text-indigo-200">
            Filtrando por celda{' '}
            <span className="font-mono font-semibold">
              P{selected.probability} × I{selected.impact}
            </span>{' '}
            <span className="text-indigo-300/80">
              ({PROB_LABEL[selected.probability]} × {IMPACT_LABEL[selected.impact]})
            </span>{' '}
            · {filtered.length} de {items.length} riesgos
          </div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary"
          >
            <ClearIcon className="h-3 w-3" />
            Limpiar filtro
          </button>
        </div>
      )}

      <ConsolidatedRiskList items={filtered} />
    </>
  )
}
