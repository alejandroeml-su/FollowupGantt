/**
 * Wave P8 · Equipo P8-2 — Cálculo puro del score y tier de un riesgo.
 *
 * Score = probability × impact ∈ [1, 25]. Tier según matriz PMBOK 5×5:
 *
 *     score      tier
 *      1- 4      LOW
 *      5-10      MEDIUM
 *     11-16      HIGH
 *     17-25      CRITICAL
 *
 * Sin dependencias: este módulo se importa tanto desde server actions como
 * desde componentes cliente (`RiskMatrix`, `RiskRegisterTable`).
 */

import type {
  ImpactLevel,
  ProbabilityLevel,
  RiskTier,
} from './types'

/** Validador estricto de probability/impact ∈ {1..5}. */
function assertLevel(value: number, label: 'probability' | 'impact'): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(
      `[INVALID_${label.toUpperCase()}] ${label} debe ser entero ∈ [1,5], recibido: ${value}`,
    )
  }
}

/** Score crudo = probability × impact, validando rangos. */
export function computeRiskScore(
  probability: number,
  impact: number,
): number {
  assertLevel(probability, 'probability')
  assertLevel(impact, 'impact')
  return probability * impact
}

/**
 * Clasifica un score numérico en su tier. NO valida rango (acepta 0+).
 * Usar `computeRiskScore` para obtener un score validado a partir de los
 * niveles crudos.
 */
export function tierFromScore(score: number): RiskTier {
  if (!Number.isFinite(score) || score < 1) return 'LOW'
  if (score <= 4) return 'LOW'
  if (score <= 10) return 'MEDIUM'
  if (score <= 16) return 'HIGH'
  return 'CRITICAL'
}

/**
 * Helper conveniente: dado probability/impact crudos, devuelve `{ score, tier }`
 * en un solo paso. Lanza si los valores son inválidos.
 */
export function evaluateRisk(
  probability: ProbabilityLevel,
  impact: ImpactLevel,
): { score: number; tier: RiskTier } {
  const score = computeRiskScore(probability, impact)
  return { score, tier: tierFromScore(score) }
}

/**
 * Color Tailwind asociado a cada tier — usado por `RiskMatrix` y badges.
 * Sigue la paleta verde→amarillo→naranja→rojo del calor PMI.
 *
 * Se devuelve sólo la utility de fondo para que el componente componga
 * con foreground/border según el contexto (cell vs badge).
 */
export const TIER_BG_CLASS: Record<RiskTier, string> = {
  LOW: 'bg-emerald-500/15',
  MEDIUM: 'bg-yellow-500/20',
  HIGH: 'bg-orange-500/25',
  CRITICAL: 'bg-red-500/30',
}

export const TIER_BORDER_CLASS: Record<RiskTier, string> = {
  LOW: 'border-emerald-500/40',
  MEDIUM: 'border-yellow-500/40',
  HIGH: 'border-orange-500/50',
  CRITICAL: 'border-red-500/60',
}

export const TIER_TEXT_CLASS: Record<RiskTier, string> = {
  LOW: 'text-emerald-700 dark:text-emerald-300',
  MEDIUM: 'text-yellow-700 dark:text-yellow-300',
  HIGH: 'text-orange-700 dark:text-orange-300',
  CRITICAL: 'text-red-700 dark:text-red-300',
}
