/**
 * API REST v1 (Ola P4 · Equipo P4-2) — catálogo de scopes.
 *
 * Cada token tiene una lista de scopes (JSON `string[]`) que gobierna a qué
 * endpoints puede acceder. Los scopes siguen la convención `<recurso>:<verbo>`
 * con `read`/`write`/`admin` como verbos canónicos:
 *
 *   - `*:read`  → permite GET sobre el recurso.
 *   - `*:write` → permite GET + POST/PUT/PATCH/DELETE sobre el recurso.
 *   - `*:admin` → reservado para operaciones especiales (capture baseline,
 *                 administración de webhooks). Implica `write`.
 *
 * El scope `*` (wildcard) implica TODO. Útil para tokens internos / SUPER_ADMIN.
 *
 * Validación: `validateScopes` se invoca tanto al crear el token (antes de
 * persistir) como al chequear cada request (`requireScope`). Mantener este
 * archivo como fuente única de verdad — la UI lista scopes desde aquí.
 */

export const KNOWN_SCOPES = [
  'projects:read',
  'projects:write',
  'tasks:read',
  'tasks:write',
  'dependencies:read',
  'dependencies:write',
  'baselines:read',
  'baselines:admin',
  'webhooks:admin',
  '*',
] as const

export type Scope = (typeof KNOWN_SCOPES)[number]

const KNOWN_SET = new Set<string>(KNOWN_SCOPES)

/**
 * Filtra/valida un array entrante. Devuelve solo los scopes reconocidos
 * deduplicados; no lanza. Si el array contiene scopes desconocidos los
 * descarta — el caller decide si tratar eso como error UX.
 */
export function validateScopes(input: unknown): Scope[] {
  if (!Array.isArray(input)) return []
  const out: Scope[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    if (!KNOWN_SET.has(raw)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(raw as Scope)
  }
  return out
}

/**
 * `true` si la lista de scopes de un token cubre el scope requerido.
 *
 * Reglas:
 *   - `*` cubre todo.
 *   - `<resource>:admin` implica `<resource>:write` y `<resource>:read`.
 *   - `<resource>:write` implica `<resource>:read`.
 *   - El scope literal exacto siempre cubre.
 */
export function hasScope(
  tokenScopes: readonly string[],
  required: Scope,
): boolean {
  if (tokenScopes.includes('*')) return true
  if (tokenScopes.includes(required)) return true

  const colonIdx = required.indexOf(':')
  if (colonIdx < 0) return false
  const resource = required.slice(0, colonIdx)
  const verb = required.slice(colonIdx + 1)

  // `:read` se cubre con write o admin del mismo recurso.
  if (verb === 'read') {
    return (
      tokenScopes.includes(`${resource}:write`) ||
      tokenScopes.includes(`${resource}:admin`)
    )
  }
  // `:write` se cubre con admin.
  if (verb === 'write') {
    return tokenScopes.includes(`${resource}:admin`)
  }
  return false
}
