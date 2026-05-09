/**
 * Wave P11-PMI (HU-12.2) — Mendelow engagement strategy helper.
 *
 * Función pura · vive fuera de `'use server'` para poder importarse
 * desde Client Components (regla del proyecto: archivos con 'use server'
 * solo pueden exportar funciones async).
 */

export type StakeholderLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type StakeholderInfluence = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'

/**
 * Engagement strategy sugerida según matriz poder×interés (Mendelow).
 */
export function suggestEngagementStrategy(
  power: StakeholderLevel,
  interest: StakeholderLevel,
): string {
  if (power === 'HIGH' && interest === 'HIGH') return 'Manage Closely'
  if (power === 'HIGH') return 'Keep Satisfied'
  if (interest === 'HIGH') return 'Keep Informed'
  return 'Monitor'
}
