/**
 * Wave P8 · Equipo P8-2 — Tipos puros del módulo Risk Register.
 *
 * Aislados aquí (sin Prisma ni I/O) para que los tests unitarios y los
 * componentes cliente puedan consumirlos sin arrastrar `@prisma/client`.
 *
 * Las constantes `PROBABILITY_LEVELS` / `IMPACT_LEVELS` son la fuente de
 * verdad para la matriz UI 5×5 (`RiskMatrix`).
 */

/** Estados del lifecycle del riesgo (paridad con `RiskStatus` en Prisma). */
export type RiskStatus = 'OPEN' | 'MITIGATING' | 'ACCEPTED' | 'CLOSED'

/** Niveles posibles de probability/impact (matriz 5×5 PMBOK). */
export type ProbabilityLevel = 1 | 2 | 3 | 4 | 5
export type ImpactLevel = 1 | 2 | 3 | 4 | 5

/** Tier de severidad derivado del score = probability × impact. */
export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export const PROBABILITY_LEVELS: readonly ProbabilityLevel[] = [1, 2, 3, 4, 5]
export const IMPACT_LEVELS: readonly ImpactLevel[] = [1, 2, 3, 4, 5]

export const RISK_STATUS_VALUES: readonly RiskStatus[] = [
  'OPEN',
  'MITIGATING',
  'ACCEPTED',
  'CLOSED',
] as const

/**
 * Forma serializable del Risk para enviar de server actions a clientes.
 * Las fechas se transmiten como ISO strings para evitar problemas de
 * serialización RSC.
 */
export interface SerializedRisk {
  id: string
  projectId: string
  projectName: string | null
  title: string
  description: string | null
  probability: ProbabilityLevel
  impact: ImpactLevel
  /** Calculado en server: probability * impact ∈ [1, 25]. */
  score: number
  /** Calculado en server a partir del score. */
  tier: RiskTier
  status: RiskStatus
  ownerId: string | null
  ownerName: string | null
  mitigation: string | null
  triggerDelayDays: number | null
  detectedAt: string
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

/** Etiquetas humanas en español para los niveles. */
export const PROBABILITY_LABEL: Record<ProbabilityLevel, string> = {
  1: 'Muy baja',
  2: 'Baja',
  3: 'Media',
  4: 'Alta',
  5: 'Muy alta',
}

export const IMPACT_LABEL: Record<ImpactLevel, string> = {
  1: 'Insignificante',
  2: 'Menor',
  3: 'Moderado',
  4: 'Mayor',
  5: 'Catastrófico',
}

export const TIER_LABEL: Record<RiskTier, string> = {
  LOW: 'Bajo',
  MEDIUM: 'Medio',
  HIGH: 'Alto',
  CRITICAL: 'Crítico',
}

export const STATUS_LABEL: Record<RiskStatus, string> = {
  OPEN: 'Abierto',
  MITIGATING: 'Mitigando',
  ACCEPTED: 'Aceptado',
  CLOSED: 'Cerrado',
}
