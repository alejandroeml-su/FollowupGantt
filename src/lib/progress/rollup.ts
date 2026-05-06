/**
 * Cálculo de "% avance" agregado (rollup) para tareas con jerarquía.
 *
 * Regla:
 *   - Si la tarea NO tiene subtareas → su `progress` directo (0..100).
 *   - Si tiene subtareas → promedio simple del rollup de cada subtarea.
 *     (Recursivo: una subtarea con sub-subtareas también promedia las suyas.)
 *
 * Decisiones:
 *   - Promedio NO ponderado por estimación, esfuerzo o storyPoints. Para
 *     ponderar requeriríamos campos consistentes en todas las tareas; el
 *     MVP usa promedio simple. Iteración futura puede reemplazar la
 *     función `weight()` por `task.storyPoints ?? 1` o similar.
 *   - Subtareas archivadas se EXCLUYEN del cálculo (no contribuyen ni al
 *     numerador ni al denominador) — alineado con el filtro `archivedAt:null`
 *     que usan los queries de la app.
 *   - El resultado se redondea al entero más cercano para presentación.
 *   - Función pura: no toca DB, no I/O, deterministic — segura de llamar
 *     en cualquier render.
 */

export type ProgressRollupNode = {
  progress: number
  archivedAt?: Date | string | null
  subtasks?: ProgressRollupNode[] | null
}

/**
 * Devuelve el % de avance (0..100, entero) calculado recursivamente.
 *
 * @example
 *   computeRolledUpProgress({ progress: 50 }) // → 50  (sin subs)
 *   computeRolledUpProgress({
 *     progress: 0,
 *     subtasks: [
 *       { progress: 100 },
 *       { progress: 50 },
 *     ],
 *   }) // → 75  (promedio: (100+50)/2 = 75)
 */
export function computeRolledUpProgress(task: ProgressRollupNode): number {
  const subs = (task.subtasks ?? []).filter((s) => !s.archivedAt)
  if (subs.length === 0) {
    return clamp(Math.round(task.progress ?? 0))
  }
  const sum = subs.reduce(
    (acc, s) => acc + computeRolledUpProgress(s),
    0,
  )
  return clamp(Math.round(sum / subs.length))
}

/**
 * Variante que también devuelve el flag `derived`: true si el % se
 * calculó desde subtareas (no es el campo `progress` directo). Útil
 * para que la UI distinga "manual" vs "rollup".
 */
export function computeProgressWithSource(task: ProgressRollupNode): {
  percent: number
  derived: boolean
  childCount: number
} {
  const subs = (task.subtasks ?? []).filter((s) => !s.archivedAt)
  if (subs.length === 0) {
    return {
      percent: clamp(Math.round(task.progress ?? 0)),
      derived: false,
      childCount: 0,
    }
  }
  const sum = subs.reduce(
    (acc, s) => acc + computeRolledUpProgress(s),
    0,
  )
  return {
    percent: clamp(Math.round(sum / subs.length)),
    derived: true,
    childCount: subs.length,
  }
}

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 100) return 100
  return n
}
