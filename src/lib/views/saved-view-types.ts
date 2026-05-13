/**
 * Constantes y helpers puros para "Vistas guardadas".
 *
 * Este archivo NO tiene `'use server'` porque exporta valores y funciones
 * sincrónicas (`isValidGrouping`, `VIEW_SURFACES`, etc.). Las server actions
 * que las usan viven en `src/lib/actions/saved-views.ts` (que sí lleva
 * `'use server'`) e importan desde aquí.
 */

export const VIEW_SURFACES = ['LIST', 'KANBAN', 'GANTT', 'CALENDAR', 'TABLE'] as const
export type ViewSurfaceLiteral = (typeof VIEW_SURFACES)[number]

/**
 * Lista cerrada de claves de grouping aceptadas (D-SV-3). El sufijo
 * `custom_field:<id>` se valida con regex aparte para no enumerar todos los
 * customFieldIds posibles.
 */
export const GROUPING_KEYS = [
  'project',
  'assignee',
  'sprint',
  'phase',
  'status',
  'priority',
  'tags',
] as const

export const CUSTOM_FIELD_GROUPING_RE = /^custom_field:[a-zA-Z0-9_-]{1,64}$/

function isValidSingleGrouping(value: string): boolean {
  if ((GROUPING_KEYS as readonly string[]).includes(value)) return true
  return CUSTOM_FIELD_GROUPING_RE.test(value)
}

/**
 * Acepta tanto formato legacy single (`"assignee"`) como multi-grouping
 * (Wave 2026-05-12): CSV de keys válidas, ej. `"status,assignee"`. La UI
 * usa el array; el shim CSV evita migrar el schema de DB.
 */
export function isValidGrouping(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return true
  // Soporte CSV multi-grouping.
  if (value.includes(',')) {
    const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) return false
    return parts.every(isValidSingleGrouping)
  }
  return isValidSingleGrouping(value)
}

/** Convierte la persistencia (string | string[] | null) en array uniforme. */
export function parseGrouping(value: unknown): string[] {
  if (value === null || value === undefined || value === '') return []
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
  }
  return []
}

export type SavedViewErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SURFACE'
  | 'INVALID_GROUPING'
  | 'VIEW_NOT_FOUND'
  | 'VIEW_NAME_DUPLICATE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
