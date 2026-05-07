/**
 * Wave P10 (HU-10.1) — Reglas puras para derivar `ProjectHealthStatus`.
 *
 * Sin Prisma, sin I/O. Recibe los inputs ya cargados y devuelve el status.
 * Esto permite tests unit determinísticos y cambiar reglas sin tocar queries.
 *
 * Reglas (orden de evaluación; gana la primera que aplica):
 *  1. BLOCKED · si hay >0 riesgos HIGH abiertos Y CPI < 0.7
 *  2. DELAYED · si SPI < 0.85 (cronograma claramente atrasado)
 *  3. AT_RISK · si SPI < 0.95 OR CPI < 0.95 OR riesgos HIGH > 0
 *  4. ON_TRACK · en otro caso (incluye casos sin EVM data)
 *
 * Las reglas son intencionalmente conservadoras. Avante puede ajustar
 * thresholds en el futuro vía configuración por workspace.
 */

import type { ProjectHealthStatus } from './types'

export interface HealthInput {
  cpi: number | null
  spi: number | null
  highRiskCount: number
}

const SPI_DELAYED = 0.85
const SPI_AT_RISK = 0.95
const CPI_BLOCKED = 0.7
const CPI_AT_RISK = 0.95

export function deriveHealthStatus(input: HealthInput): ProjectHealthStatus {
  const { cpi, spi, highRiskCount } = input

  // Regla 1: BLOCKED · combinación seria de cost overrun + riesgo abierto
  if (
    highRiskCount > 0 &&
    cpi != null &&
    cpi < CPI_BLOCKED
  ) {
    return 'BLOCKED'
  }

  // Regla 2: DELAYED · cronograma muy atrasado
  if (spi != null && spi < SPI_DELAYED) {
    return 'DELAYED'
  }

  // Regla 3: AT_RISK · señales de alerta sin ser crítico
  if (
    (spi != null && spi < SPI_AT_RISK) ||
    (cpi != null && cpi < CPI_AT_RISK) ||
    highRiskCount > 0
  ) {
    return 'AT_RISK'
  }

  // Regla 4: por defecto verde
  return 'ON_TRACK'
}

/** Color tag UI sugerido por status (consume Tailwind tokens). */
export const HEALTH_COLOR: Record<ProjectHealthStatus, string> = {
  ON_TRACK: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  AT_RISK: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  DELAYED: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  BLOCKED: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
}

/** Etiquetas humanas es-MX. */
export const HEALTH_LABEL: Record<ProjectHealthStatus, string> = {
  ON_TRACK: 'En tiempo',
  AT_RISK: 'En riesgo',
  DELAYED: 'Atrasado',
  BLOCKED: 'Bloqueado',
}
