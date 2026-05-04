/**
 * Ola P4 · P4-4 — Internacionalización nativa (sin libs externas).
 *
 * Diseño:
 *   - Diccionarios JSON estáticos (`messages/<locale>.json`) con keys
 *     jerárquicas tipo `sidebar.dashboard` o `task.form.title`.
 *   - `t(key, params?, locale?)` resuelve la clave en el diccionario del
 *     locale; si no encuentra la key cae al locale por defecto (`es`) y,
 *     en último recurso, retorna la propia key (útil para detectar
 *     traducciones faltantes en QA).
 *   - Interpolación mínima estilo `{name}` reemplazada con `params`.
 *
 * Decisiones (Ola P4):
 *   - Default locale `es` por convención del proyecto FollowupGantt
 *     (Edwin + equipo Avante trabajan en español).
 *   - Cookie `x-locale` (NO `next-intl`/`i18next`) — leemos en SSR vía
 *     `next/headers` y en cliente vía `document.cookie`.
 *   - Mantener este módulo "puro" (sin imports de Next/React) para que
 *     pueda usarse desde server components, client components, server
 *     actions y tests unitarios.
 */

import esMessages from './messages/es.json'
import enMessages from './messages/en.json'

export const SUPPORTED_LOCALES = ['es', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'es'
export const LOCALE_COOKIE = 'x-locale'

type Messages = typeof esMessages

const DICTIONARIES: Record<Locale, Messages> = {
  es: esMessages,
  en: enMessages as Messages,
}

/**
 * Type guard para distinguir locales soportados de strings arbitrarios
 * (cookies manipuladas, query params).
 */
export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  )
}

/**
 * Normaliza un valor potencialmente inválido (cookie, header) a un
 * locale soportado. Si no se puede, retorna `DEFAULT_LOCALE`.
 */
export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/**
 * Recorre un diccionario por keys jerárquicas (`a.b.c`). Retorna
 * `undefined` si algún tramo no existe o si el valor final no es string.
 */
function lookup(dict: unknown, key: string): string | undefined {
  const parts = key.split('.')
  let cursor: unknown = dict
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return typeof cursor === 'string' ? cursor : undefined
}

/**
 * Reemplaza placeholders `{name}` con `params.name`. Si el param es
 * `undefined` deja el placeholder intacto (señal visual de bug en QA).
 */
function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = params[name]
    return v === undefined || v === null ? match : String(v)
  })
}

/**
 * Resuelve una clave de traducción. La firma se mantiene estable entre
 * server y cliente para que componentes puedan migrar de uno a otro sin
 * cambiar la llamada.
 *
 * @param key      Clave jerárquica (`sidebar.dashboard`).
 * @param params   Variables para interpolación opcional (`{count}`).
 * @param locale   Locale a usar. Si se omite, default `es`.
 * @returns        Cadena traducida; cae al default y luego a la propia
 *                 key si no hay match (modo "missing-keys-visibles" para
 *                 QA).
 */
export function t(
  key: string,
  params?: Record<string, string | number>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const primary = lookup(DICTIONARIES[locale], key)
  if (primary !== undefined) return interpolate(primary, params)

  if (locale !== DEFAULT_LOCALE) {
    const fallback = lookup(DICTIONARIES[DEFAULT_LOCALE], key)
    if (fallback !== undefined) return interpolate(fallback, params)
  }

  // Modo desarrollo: devolver la key cruda hace que las strings
  // faltantes salten a la vista en QA visual sin romper la UI.
  return key
}

/**
 * Devuelve el diccionario completo de un locale. Útil para componentes
 * server que quieren serializar al cliente todo el bundle (en lugar de
 * llamar `t()` por cada string).
 */
export function getMessages(locale: Locale = DEFAULT_LOCALE): Messages {
  return DICTIONARIES[locale]
}

/**
 * Conveniencia: factory para usos en los que ya conoces el locale y no
 * quieres pasarlo en cada llamada (`const tt = createT('en'); tt('...')`).
 */
export function createT(locale: Locale = DEFAULT_LOCALE) {
  return (key: string, params?: Record<string, string | number>) =>
    t(key, params, locale)
}
