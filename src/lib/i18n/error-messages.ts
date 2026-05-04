/**
 * Ola P4 · P4-4 — Mapeo de errores tipados a mensajes traducidos.
 *
 * Convención del proyecto FollowupGantt: las server actions lanzan
 * Error con prefijo `[CODE] detalle`. Ej: `[UNAUTHORIZED] Sesión requerida`,
 * `[FORBIDDEN] No tienes acceso al proyecto`, `[INVALID_INPUT] email`…
 *
 * Este módulo:
 *   1. Extrae el `[CODE]` del mensaje de error.
 *   2. Lo mapea a una clave del diccionario `error.*`.
 *   3. Devuelve la traducción en el locale activo.
 *
 * Ventaja: el código del error sigue siendo estable (mantenemos los
 * `throw new Error('[UNAUTHORIZED] ...')` existentes), y solo cambiamos
 * la presentación en el cliente.
 */

import { type Locale, t } from './translate'

const CODE_TO_KEY: Record<string, string> = {
  UNAUTHORIZED: 'error.unauthorized',
  FORBIDDEN: 'error.forbidden',
  NOT_FOUND: 'error.notFound',
  INVALID_INPUT: 'error.invalidInput',
  INVALID_CREDENTIALS: 'error.invalidCredentials',
  INVALID_SESSION: 'error.invalidSession',
  CONFLICT: 'error.conflict',
  RATE_LIMITED: 'error.rateLimited',
  SERVER_ERROR: 'error.serverError',
  NETWORK_ERROR: 'error.networkError',
}

const CODE_REGEX = /^\s*\[([A-Z][A-Z0-9_]*)\](?::|\s+|$)/

/**
 * Extrae el código `[CODE]` del prefijo de un mensaje. Devuelve
 * `undefined` si no coincide con la convención.
 */
export function parseErrorCode(message: string): string | undefined {
  const m = message.match(CODE_REGEX)
  return m?.[1]
}

/**
 * Traduce un mensaje de error tipado al locale dado.
 *
 * Estrategia:
 *   - Si el mensaje tiene `[CODE]` reconocido, devuelve la traducción
 *     correspondiente.
 *   - Si tiene `[CODE]` no mapeado, devuelve `error.unknown` (genérico)
 *     para no exponer códigos internos al usuario.
 *   - Si no tiene `[CODE]`, devuelve el mensaje tal cual (mensajes ya
 *     formateados para el usuario por la action — p. ej. zod issues).
 *
 * @param input    Mensaje string o instancia de Error.
 * @param locale   Locale destino. Default `es`.
 */
export function translateError(
  input: string | Error | unknown,
  locale?: Locale,
): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === 'string'
        ? input
        : ''

  if (!raw) return t('error.unknown', undefined, locale)

  const code = parseErrorCode(raw)
  if (!code) return raw

  const key = CODE_TO_KEY[code]
  if (!key) return t('error.unknown', undefined, locale)

  return t(key, undefined, locale)
}

/**
 * Tabla pública (solo lectura) para que tests u otras utilidades puedan
 * inspeccionar el catálogo soportado sin reflexión sobre el módulo.
 */
export const ERROR_CODE_KEYS: Readonly<Record<string, string>> = CODE_TO_KEY
