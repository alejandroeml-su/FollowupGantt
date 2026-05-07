/**
 * Wave P9 R2 (HU-9.8) — Definition of Ready & Done por proyecto.
 *
 * Tipos + helpers puros para validar el shape de `Project.dorTemplate`
 * y `Project.dodTemplate`. Ambos son Json en BD con shape esperado
 * `string[]` (lista de criterios ordenados).
 *
 * Decisión: Json simple (no normalización) porque los criterios son
 * culturales y rara vez se queryan individualmente. Si crece la
 * necesidad de tracking por criterio, normalizar a tabla
 * `ProjectChecklistItem` en R3.
 */

/** Lista normalizada (sin duplicados, sin vacíos, trim aplicado). */
export type ChecklistTemplate = string[]

/** Sanitiza un payload Json al shape `ChecklistTemplate`. */
export function normalizeChecklistTemplate(raw: unknown): ChecklistTemplate {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    // Dedupe case-insensitive (evita "Tests pasan" y "tests pasan").
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/** True si la plantilla es válida y tiene al menos 1 criterio. */
export function hasTemplateContent(raw: unknown): boolean {
  return normalizeChecklistTemplate(raw).length > 0
}

/**
 * Plantillas sugeridas por defecto. Útiles para guiar al usuario al
 * configurar por primera vez su proyecto. NO se aplican
 * automáticamente — sólo se ofrecen como "Insertar plantilla sugerida".
 */
export const DEFAULT_DOR_TEMPLATE: readonly string[] = [
  'La historia tiene Como un / Quiero / Para definidos',
  'Tiene al menos 1 criterio de aceptación',
  'Está estimada en Story Points',
  'Diseño UX revisado (si aplica)',
  'No depende de tareas pendientes externas',
] as const

export const DEFAULT_DOD_TEMPLATE: readonly string[] = [
  'Todos los criterios de aceptación marcados',
  'Code review aprobado',
  'Tests unit + integration pasando',
  'Sin warnings de lint ni typescript',
  'Documentación inline actualizada (si aplica)',
  'Desplegado en staging y validado',
] as const
