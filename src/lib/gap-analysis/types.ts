/**
 * US-9.2 · Wave R5 — Gap Analysis · tipos compartidos cliente/servidor.
 *
 * Estos tipos viven aquí (sin `server-only`) para poder ser importados
 * tanto por las server actions como por los componentes React.
 */

import type {
  GapAnalysisStatus,
  GapDimensionKind,
  GapDimensionActionStatus,
} from '@prisma/client'

export type { GapAnalysisStatus, GapDimensionKind, GapDimensionActionStatus }

// ───────────────────────── Color buckets ─────────────────────────

/**
 * Color cualitativo del gap entre AS-IS y TO-BE. Lo decidimos en
 * función de la magnitud del gap relativo al objetivo. Mantenemos la
 * paleta consistente con la del Risk Register (verde/amarillo/rojo)
 * para reducir carga cognitiva del usuario.
 */
export type GapColor = 'green' | 'amber' | 'red' | 'neutral'

/**
 * Devuelve el color asociado a un gap. La heurística:
 *   - `neutral` cuando faltan valores (no comparable).
 *   - `green`   cuando AS-IS ≥ TO-BE (objetivo alcanzado o superado).
 *   - `amber`   cuando el gap absoluto representa ≤ 25% del TO-BE.
 *   - `red`     en cualquier otro caso.
 *
 * El umbral 25% es arbitrario y consistente con la práctica común en
 * BSC (Balanced Scorecard). Si TO-BE = 0 (raro pero válido), tratamos
 * AS-IS ≤ 0 como `green` (objetivo es no tener nada). Si TO-BE < AS-IS
 * y se interpreta como "menos es mejor", consideramos green también.
 */
export function computeGapColor(
  asIs: number | null | undefined,
  toBe: number | null | undefined,
): GapColor {
  if (asIs == null || toBe == null) return 'neutral'

  // Caso degenerado: objetivo es cero (ej. "0 defectos abiertos").
  if (toBe === 0) {
    return asIs <= 0 ? 'green' : 'red'
  }

  // Caso "más es mejor" (toBe > asIs intenta crecer hacia toBe).
  if (toBe > 0) {
    if (asIs >= toBe) return 'green'
    const gap = toBe - asIs
    const ratio = gap / toBe
    if (ratio <= 0.25) return 'amber'
    return 'red'
  }

  // Caso "menos es mejor" (toBe < 0, raro): comparamos en magnitudes.
  if (asIs <= toBe) return 'green'
  const gap = Math.abs(asIs - toBe)
  const ratio = gap / Math.abs(toBe)
  if (ratio <= 0.25) return 'amber'
  return 'red'
}

/**
 * Calcula la magnitud del gap (TO-BE − AS-IS). Devuelve `null` si
 * cualquiera de los dos valores es null/undefined.
 */
export function computeGapMagnitude(
  asIs: number | null | undefined,
  toBe: number | null | undefined,
): number | null {
  if (asIs == null || toBe == null) return null
  return Number((toBe - asIs).toFixed(4))
}

// ───────────────────────── Serialized DTOs ─────────────────────────

export type SerializedGapDimensionAction = {
  id: string
  dimensionId: string
  taskId: string | null
  taskTitle: string | null
  freeText: string | null
  status: GapDimensionActionStatus
  createdAt: string
  updatedAt: string
}

export type SerializedGapDimension = {
  id: string
  gapAnalysisId: string
  name: string
  category: string | null
  kind: GapDimensionKind
  metricKey: string | null
  asIsValue: number | null
  toBeValue: number | null
  unit: string | null
  weight: number | null
  notes: string | null
  metricMetadata: Record<string, unknown> | null
  position: number
  gap: number | null
  color: GapColor
  actions: SerializedGapDimensionAction[]
  createdAt: string
  updatedAt: string
}

export type SerializedGapAnalysis = {
  id: string
  projectId: string
  projectName: string | null
  name: string
  description: string | null
  targetDate: string | null
  status: GapAnalysisStatus
  createdById: string | null
  createdByName: string | null
  dimensions: SerializedGapDimension[]
  /**
   * Agregado a nivel análisis: porcentaje de dimensiones cuyo gap está
   * en verde (objetivo alcanzado). Se calcula sobre dimensiones con
   * AS-IS y TO-BE definidos.
   */
  overallScore: number | null
  createdAt: string
  updatedAt: string
}
