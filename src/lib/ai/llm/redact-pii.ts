/**
 * Ola P7 · Equipo P7-1 · LLM adapter base — Redacción heurística de PII.
 *
 * Antes de mandar un prompt al provider externo (Anthropic / OpenAI),
 * pasamos el texto por `redactPII` para limitar el blast radius de
 * cualquier dato sensible que el usuario haya pegado por error en
 * descripciones de tareas, comentarios, notas de proyecto, etc.
 *
 * Cobertura (orden de aplicación importa):
 *   1. URLs con `?token=...` o `&apikey=...` → preservamos host/path,
 *      reemplazamos sólo el valor del param.
 *   2. API tokens estilo `fg_*` (FollowupGantt API keys, ver `keys.ts`)
 *      y `sk_*` (OpenAI/Stripe convención).
 *   3. Bearer tokens en headers (`Authorization: Bearer ...`).
 *   4. Emails (incluyendo subdominios y TLDs cortos).
 *   5. Teléfonos (formatos MX `+52` y genéricos 10+ dígitos con
 *      separadores `- ()`).
 *   6. RFC mexicano (4 letras + 6 dígitos + 3 alfanum, con o sin guión).
 *
 * Nota: NO es un escáner DLP — es una mitigación heurística "best
 * effort". Edwin debe seguir tratando los prompts como datos potencialmente
 * expuestos al proveedor.
 *
 * Determinismo: regex puros, sin estado. Idempotente: aplicar dos veces
 * produce el mismo resultado (los placeholders no contienen texto que
 * vuelva a matchear).
 */

const PLACEHOLDERS = {
  EMAIL: '[EMAIL]',
  PHONE: '[PHONE]',
  RFC: '[RFC]',
  TOKEN: '[TOKEN]',
  URL_TOKEN: '[URL_TOKEN]',
  BEARER: '[BEARER]',
} as const

// 1. URL params sensibles. Capturamos el nombre del param para reemplazar
// sólo el valor, preservando la URL legible (host/path/otros params).
// Lista de keys consideradas sensibles (case-insensitive). Como literal
// regex (no `new RegExp`) para no lidiar con doble-escape de `\s`.
const URL_TOKEN_REGEX =
  /([?&])(token|apikey|api[_-]?key|access[_-]?token|secret|password|pwd|auth)=([^&\s#]+)/gi

// 2. API tokens FG / SK / GH (gh personal access tokens).
// `fg_live_xxx` y `fg_test_xxx` (convención de keys.ts), `sk_live_*`,
// `sk_test_*`, `ghp_*`, `gho_*`. 16+ chars alphanumeric tras el prefijo.
const TOKEN_REGEX = /\b(fg_(?:live|test)_[A-Za-z0-9]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,})\b/g

// 3. Bearer tokens. Capturamos `Bearer <token>` y reemplazamos el valor.
const BEARER_REGEX = /\b(Bearer)\s+([A-Za-z0-9._\-+/=]{16,})/gi

// 4. Emails. Versión laxa: usuario + @ + dominio con TLD 2-24 chars.
// Aceptamos `+` en el local part (Gmail-style aliases).
const EMAIL_REGEX = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}\b/g

// 5. RFC mexicano. Personas físicas: 4 letras + 6 dígitos + 3 alfanum.
// Personas morales: 3 letras + 6 dígitos + 3 alfanum. Aceptamos guión
// opcional `XAXX-010101-000`.
const RFC_REGEX = /\b([A-ZÑ&]{3,4})-?(\d{6})-?([A-Z0-9]{3})\b/g

// 6. Teléfonos. Cubrimos:
//   - +52 1 55 1234 5678 (MX con prefijo país y opcional dígito celular)
//   - (555) 123-4567 / 555-123-4567 / 555.123.4567
//   - 10 dígitos seguidos
// Evitamos matches de números cortos (años, IDs). Mínimo 10 dígitos.
// Dos alternativas: (a) sin paréntesis (cuerpo de 3 grupos: 2-4+2-4+3-4),
// (b) con paréntesis de área (cuerpo: 3-4 + 3-4).
const PHONE_REGEX =
  /(?<![\w.])(?:\+?\d{1,3}[\s.\-]?)?(?:(?:\(\d{2,4}\)[\s.\-]?)?\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{3,4}|\(\d{2,4}\)[\s.\-]?\d{3,4}[\s.\-]?\d{3,4})(?![\w.])/g

/**
 * Redacta PII heurísticamente. Devuelve el texto modificado.
 *
 * Orden importa: tokens y URL params se procesan ANTES que emails para
 * evitar que un email dentro de un token corrupto haga doble trabajo.
 * Phone se procesa al final (es el más laxo).
 */
export function redactPII(text: string): string {
  if (!text) return text

  let out = text

  // 1. URLs con tokens sensibles.
  out = out.replace(URL_TOKEN_REGEX, (_m, sep: string, key: string) => {
    return `${sep}${key}=${PLACEHOLDERS.URL_TOKEN}`
  })

  // 2. Tokens API (fg_*, sk_*, ghp_*, gho_*).
  out = out.replace(TOKEN_REGEX, PLACEHOLDERS.TOKEN)

  // 3. Bearer tokens.
  out = out.replace(BEARER_REGEX, (_m, b: string) => `${b} ${PLACEHOLDERS.BEARER}`)

  // 4. Emails.
  out = out.replace(EMAIL_REGEX, PLACEHOLDERS.EMAIL)

  // 5. RFC. Validamos que no sea sólo letras o sólo números (la regex
  // ya lo asegura pero el guión opcional puede generar matches raros).
  out = out.replace(RFC_REGEX, PLACEHOLDERS.RFC)

  // 6. Teléfonos. Sólo si quedan al menos 10 dígitos en el match.
  out = out.replace(PHONE_REGEX, (m) => {
    const digits = m.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 15) return m
    return PLACEHOLDERS.PHONE
  })

  return out
}

/**
 * Variante batch para redactar arrays de strings (ej. lista de
 * descripciones de tareas).
 */
export function redactPIIBatch(texts: readonly string[]): string[] {
  return texts.map((t) => redactPII(t))
}

/** Útil en tests / debugging para listar los placeholders soportados. */
export function listRedactionPlaceholders(): readonly string[] {
  return Object.values(PLACEHOLDERS)
}
