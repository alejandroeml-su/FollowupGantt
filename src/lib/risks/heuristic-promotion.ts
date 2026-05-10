/**
 * Wave R-360 — Helpers puros para la promoción de insights heurísticos
 * (TaskInsight kind=DELAY_RISK) a Risks formales del PMBOK 5×5.
 *
 * Archivo "puro" (sin `'use server'`): solo funciones síncronas usables
 * desde server actions y tests unitarios. Esto cumple la regla del repo:
 * los archivos `'use server'` solo exportan funciones async; los helpers
 * sync viven en módulos puros gemelos.
 */

/**
 * Convierte el (level, score) de un insight DELAY_RISK heurístico a la
 * matriz PMBOK 5×5.
 *
 *  - level=high   ⇒ probability=4, impact=4 (score 16 → tier HIGH)
 *  - level=medium ⇒ probability=3, impact=3 (score  9 → tier MEDIUM)
 *  - level=low    ⇒ probability=2, impact=2 (score  4 → tier LOW)
 *
 * El `score` numérico fino (0..1) modula ±1 para suavizar bordes:
 *   - dentro de "high" si score ≥ 0.85 → probability=5, impact=5 (tier CRITICAL)
 *   - dentro de "medium" si score ≥ 0.5 → probability=3, impact=4
 *   - dentro de "low" si score < 0.2  → probability=1, impact=2
 *
 * Si `level` no viene o es desconocido, fallback razonable (3, 3) =
 * MEDIUM, que la UI permite editar tras la promoción.
 */
export function derivePmiLevels(
  level: 'high' | 'medium' | 'low' | string | undefined | null,
  score: number,
): { probability: number; impact: number } {
  const s = Math.max(0, Math.min(1, score))

  if (level === 'high') {
    if (s >= 0.85) return { probability: 5, impact: 5 }
    return { probability: 4, impact: 4 }
  }
  if (level === 'medium') {
    if (s >= 0.5) return { probability: 3, impact: 4 }
    return { probability: 3, impact: 3 }
  }
  if (level === 'low') {
    if (s < 0.2) return { probability: 1, impact: 2 }
    return { probability: 2, impact: 2 }
  }
  return { probability: 3, impact: 3 }
}
