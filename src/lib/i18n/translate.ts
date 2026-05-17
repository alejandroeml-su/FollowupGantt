/**
 * Ola P4 · P4-4 — Internacionalización nativa (sin libs externas).
 * Wave R5E · 2026-05-17 — Migrado a códigos BCP-47 (`es-MX`/`en-US`)
 * con aliases backward-compat para los códigos cortos `es`/`en` que
 * habíamos persistido en cookies de usuarios beta.
 *
 * Diseño:
 *   - Diccionarios JSON estáticos (`messages/<locale>.json`) con keys
 *     jerárquicas tipo `sidebar.dashboard` o `task.form.title`.
 *   - `t(key, params?, locale?)` resuelve la clave en el diccionario del
 *     locale; si no encuentra la key cae al locale por defecto (`es-MX`)
 *     y, en último recurso, retorna la propia key (útil para detectar
 *     traducciones faltantes en QA).
 *   - Interpolación mínima estilo `{name}` reemplazada con `params`.
 *
 * Decisiones (Ola P4 / Wave R5E):
 *   - Default locale `es-MX` por convención del proyecto FollowupGantt
 *     (Edwin + equipo Avante trabajan en español de México).
 *   - Cookie `x-locale` (NO `next-intl`/`i18next`) — leemos en SSR vía
 *     `next/headers` y en cliente vía `document.cookie`.
 *   - Mantener este módulo "puro" (sin imports de Next/React) para que
 *     pueda usarse desde server components, client components, server
 *     actions y tests unitarios.
 */

import esMxMessages from './messages/es-MX.json'
import enUsMessages from './messages/en-US.json'

export const SUPPORTED_LOCALES = ['es-MX', 'en-US'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'es-MX'
export const LOCALE_COOKIE = 'x-locale'

/**
 * Aliases backward-compat (Wave R5E): cookies persistidas con códigos
 * cortos (`es`, `en`) o variantes (`es-ES`, `en-GB`, `es-419`) se mapean
 * al locale BCP-47 más cercano que sí soportamos. También se usa al
 * resolver `Accept-Language` del navegador en `proxy.ts`.
 */
const LOCALE_ALIASES: Record<string, Locale> = {
  es: 'es-MX',
  'es-MX': 'es-MX',
  'es-419': 'es-MX',
  'es-ES': 'es-MX',
  'es-AR': 'es-MX',
  'es-CO': 'es-MX',
  'es-CL': 'es-MX',
  en: 'en-US',
  'en-US': 'en-US',
  'en-GB': 'en-US',
  'en-CA': 'en-US',
  'en-AU': 'en-US',
}

type Messages = typeof esMxMessages

const DICTIONARIES: Record<Locale, Messages> = {
  'es-MX': esMxMessages,
  'en-US': enUsMessages as Messages,
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
 *
 * Wave R5E — soportamos aliases BCP-47 + códigos cortos legacy:
 *   - `es` / `es-MX` / `es-419` / `es-ES` → `es-MX`
 *   - `en` / `en-US` / `en-GB` → `en-US`
 */
export function normalizeLocale(value: unknown): Locale {
  if (isLocale(value)) return value
  if (typeof value === 'string') {
    // Match exacto en tabla de aliases (case-sensitive en el lado
    // canónico: la cookie suele venir lowercase + el sub-tag uppercase).
    const trimmed = value.trim()
    if (LOCALE_ALIASES[trimmed]) return LOCALE_ALIASES[trimmed]
    // Last-resort: mira solo el idioma base (`es-XX` → `es`).
    const base = trimmed.toLowerCase().split('-')[0]
    if (LOCALE_ALIASES[base]) return LOCALE_ALIASES[base]
  }
  return DEFAULT_LOCALE
}

/**
 * Wave R5E — Resuelve un header `Accept-Language` a un locale soportado.
 * Estrategia: parsea pares `lang;q=weight`, ordena por `q` desc, devuelve
 * el primer match contra los aliases conocidos. Si no hay match, default.
 *
 * Diseñado para ser llamado desde el proxy en la primera visita del
 * usuario (cuando aún no existe la cookie `x-locale`).
 */
export function resolveAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...mods] = part.trim().split(';')
      const qMod = mods.find((m) => m.trim().startsWith('q='))
      const q = qMod ? Number.parseFloat(qMod.split('=')[1]) : 1
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0 }
    })
    .filter((c) => c.tag.length > 0)
    .sort((a, b) => b.q - a.q)
  for (const { tag } of candidates) {
    if (LOCALE_ALIASES[tag]) return LOCALE_ALIASES[tag]
    const base = tag.toLowerCase().split('-')[0]
    if (LOCALE_ALIASES[base]) return LOCALE_ALIASES[base]
  }
  return DEFAULT_LOCALE
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
