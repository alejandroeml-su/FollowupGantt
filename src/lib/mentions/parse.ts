/**
 * Parser de menciones `@usuario` para texto libre.
 *
 * Soporta tres formas:
 *   - `@nombre` (handle alfanumérico, lookup por User.name o User.email username)
 *   - `@email@dominio.com` (lookup directo por User.email)
 *   - `@todos` / `@everyone` — alias broadcast (resolución a participantes
 *     del task se hace en el caller, no aquí).
 *
 * Diseño:
 *   - Función pura: no toca DB, no I/O.
 *   - Soporta tildes y ñ (Unicode \p{L}).
 *   - Devuelve handles únicos preservando orden de aparición.
 *   - Ignora menciones dentro de bloques de código (entre backticks).
 *
 * Casos de borde cubiertos por tests:
 *   - Texto vacío / null → `[]`.
 *   - Mención al inicio, medio, fin del texto.
 *   - Múltiples menciones con duplicados → dedupe.
 *   - Mención seguida de puntuación (`@edwin,` o `@edwin.`) → handle limpio.
 *   - Email con dominio (`@user@avante.com`) parsea como una sola mención
 *     completa, NO como `@user` + `@avante`.
 *   - Tildes/ñ: `@maría` y `@niño` válidos.
 *   - Bloques de código: `` `@codigo` `` se ignora.
 */

const BACKTICK_BLOCK = /`[^`]*`/g

// Combina email-form y handle-form en un solo regex con alternancia
// (email-form va primero porque es más específico). Para evitar capturar
// puntuación final (`@edwin,` o `@edwin.`), el último carácter del handle
// se restringe a [letra/número/_].
//
// Pattern explanation (Unicode):
//   @                       — literal arroba
//   [\p{L}\p{N}_]           — primer carácter: letra/número/underscore (sin puntos)
//   ([\p{L}\p{N}._-]*       — body: letras/números, puntos, guiones (opcional)
//   [\p{L}\p{N}_])?         — último carácter: NO punto/guion (cierre limpio)
//   (@[\p{L}\p{N}.-]+\.\p{L}{2,})?  — sufijo opcional `@dominio.tld`
const MENTION_PATTERN =
  /@[\p{L}\p{N}_](?:[\p{L}\p{N}._-]*[\p{L}\p{N}_])?(?:@[\p{L}\p{N}.-]+\.\p{L}{2,})?/gu

/**
 * Extrae handles únicos de un texto, sin el `@` inicial.
 *
 * @returns array de handles en orden de primera aparición. Para emails,
 *   devuelve la dirección completa (sin el `@` líder). Para handles
 *   simples, devuelve el nombre/username.
 *
 * @example
 *   extractMentions("hola @edwin y @maria")
 *   // => ["edwin", "maria"]
 *
 *   extractMentions("contacta a @luis@avante.com")
 *   // => ["luis@avante.com"]
 *
 *   extractMentions("@todos revisen esto")
 *   // => ["todos"]
 */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return []

  // Quitar bloques de código entre backticks para que `@dentro` no cuente.
  const sanitized = text.replace(BACKTICK_BLOCK, ' ')

  const seen = new Set<string>()
  const ordered: string[] = []

  // Un solo regex con alternancia email/handle preserva el orden natural
  // de aparición (matchAll itera en posición ascendente).
  for (const match of sanitized.matchAll(MENTION_PATTERN)) {
    const handle = match[0].slice(1) // sin `@` inicial
    if (!seen.has(handle)) {
      seen.add(handle)
      ordered.push(handle)
    }
  }

  return ordered
}

/**
 * Compara menciones en dos versiones de un texto y devuelve solo las
 * NUEVAS — útil para `updateTask` o `updateComment` donde ya se notificó
 * a las menciones del valor original.
 *
 * @example
 *   diffNewMentions("hola @ana", "hola @ana y @luis")
 *   // => ["luis"]
 */
export function diffNewMentions(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): string[] {
  const oldSet = new Set(extractMentions(oldText))
  return extractMentions(newText).filter((h) => !oldSet.has(h))
}

/**
 * `true` si el handle es un alias broadcast (`@todos`, `@everyone`).
 */
export function isBroadcastHandle(handle: string): boolean {
  const normalized = handle.toLowerCase()
  return normalized === 'todos' || normalized === 'everyone' || normalized === 'all'
}
