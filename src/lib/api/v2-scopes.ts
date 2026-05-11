/**
 * Wave P17-B (API pública v2) · Catálogo de scopes.
 *
 * El namespace v2 reorganiza los scopes con el patrón `<verbo>:<recurso>`
 * (vs `<recurso>:<verbo>` de v1) — más legible y alineado con OAuth2 /
 * GitHub Apps. NO conviven implícitamente con v1: cada API tiene su set.
 *
 * Reglas de implicación:
 *   - `*` cubre todo (tokens internos / SUPER_ADMIN).
 *   - `write:<resource>` implica `read:<resource>`.
 *   - El scope literal exacto siempre cubre.
 */

export const KNOWN_V2_SCOPES = [
  'read:projects',
  'write:projects',
  'read:tasks',
  'write:tasks',
  'read:risks',
  'write:risks',
  /**
   * Wave R3.0 Fase 4.2 · BI Export Connector.
   *
   * Cubre `/api/v2/exports/**` (CSV) y `/api/v2/odata/**`. Es un scope
   * "agregado" sobre múltiples recursos (projects/tasks/risks/EVM) — el
   * caso de uso es justamente exportar el set completo a Tableau/PowerBI
   * sin requerir múltiples scopes simultáneos.
   */
  'read:exports',
  '*',
] as const

export type V2Scope = (typeof KNOWN_V2_SCOPES)[number]

const KNOWN_SET = new Set<string>(KNOWN_V2_SCOPES)

/**
 * Filtra/valida un array entrante. Devuelve solo los scopes reconocidos
 * deduplicados. Caller decide si tratar scopes desconocidos como error UX.
 */
export function validateV2Scopes(input: unknown): V2Scope[] {
  if (!Array.isArray(input)) return []
  const out: V2Scope[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    if (!KNOWN_SET.has(raw)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(raw as V2Scope)
  }
  return out
}

/**
 * `true` si la lista de scopes de un key cubre el scope requerido. Aplica
 * la implicación `write:* → read:*`.
 */
export function hasV2Scope(
  keyScopes: readonly string[],
  required: V2Scope,
): boolean {
  if (keyScopes.includes('*')) return true
  if (keyScopes.includes(required)) return true

  const colonIdx = required.indexOf(':')
  if (colonIdx < 0) return false
  const verb = required.slice(0, colonIdx)
  const resource = required.slice(colonIdx + 1)

  if (verb === 'read') {
    return keyScopes.includes(`write:${resource}`)
  }
  return false
}
