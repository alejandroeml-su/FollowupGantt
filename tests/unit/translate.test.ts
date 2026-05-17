import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createT,
  getMessages,
  isLocale,
  normalizeLocale,
  resolveAcceptLanguage,
  t,
} from '@/lib/i18n/translate'

/**
 * Ola P4 · P4-4 — Tests para el helper i18n nativo.
 * Wave R5E (2026-05-17) — Migrado a códigos BCP-47 (`es-MX`/`en-US`)
 * con aliases backward-compat para `es`/`en` cortos.
 *
 * Cobertura mínima:
 *   1. Resuelve keys jerárquicas en `es-MX`.
 *   2. Resuelve la misma key en `en-US` con valor distinto.
 *   3. Locale inválido → fallback al DEFAULT_LOCALE en runtime via
 *      `normalizeLocale`.
 *   4. Aliases backward-compat (`es` → `es-MX`, `en` → `en-US`).
 *   5. Key inexistente → devuelve la key cruda (modo missing-visible).
 *   6. Interpolación de placeholders `{count}` con number.
 *   7. Placeholder no provisto se mantiene literal.
 *   8. `isLocale` valida; `normalizeLocale` cae a default + aliases.
 *   9. `createT(locale)` produce factory que recuerda el locale.
 *  10. Diccionarios cubren las mismas keys principales (paridad).
 *  11. `resolveAcceptLanguage` parsea headers RFC 7231 con `q=` weights.
 */

describe('translate · i18n nativo · BCP-47', () => {
  it('resuelve clave jerárquica en español (México) por defecto', () => {
    expect(t('sidebar.dashboard')).toBe('Dashboard')
    expect(t('buttons.save')).toBe('Guardar')
    expect(t('task.priority.critical')).toBe('Crítica')
  })

  it('resuelve la misma clave en inglés (US) con un valor distinto', () => {
    expect(t('buttons.save', undefined, 'en-US')).toBe('Save')
    expect(t('filters.criticalOnly', undefined, 'en-US')).toBe('Critical path only')
  })

  it('cae al locale por defecto cuando el destino no tiene la key', () => {
    expect(t('error.unauthorized', undefined, 'en-US')).toBe(
      'Session required. Sign in to continue.',
    )
  })

  it('devuelve la key cruda cuando no existe en ningún diccionario', () => {
    expect(t('non.existent.key')).toBe('non.existent.key')
    expect(t('foo', undefined, 'en-US')).toBe('foo')
  })

  it('interpola variables `{name}` con string y number', () => {
    expect(t('filters.clearWithCount', { count: 3 })).toBe('Limpiar (3)')
    expect(t('filters.clearWithCount', { count: 0 }, 'en-US')).toBe('Clear (0)')
  })

  it('mantiene placeholder cuando el param no está', () => {
    expect(t('filters.clearWithCount')).toBe('Limpiar ({count})')
  })

  it('isLocale valida sólo BCP-47 canónico', () => {
    expect(isLocale('es-MX')).toBe(true)
    expect(isLocale('en-US')).toBe(true)
    expect(isLocale('es')).toBe(false) // short-code legacy, no es canónico
    expect(isLocale('en')).toBe(false)
    expect(isLocale('fr-FR')).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(42)).toBe(false)
  })

  it('normalizeLocale resuelve aliases backward-compat', () => {
    expect(normalizeLocale('es-MX')).toBe('es-MX')
    expect(normalizeLocale('en-US')).toBe('en-US')
    // Wave R5E — códigos cortos legacy mantenidos en cookies de usuarios beta.
    expect(normalizeLocale('es')).toBe('es-MX')
    expect(normalizeLocale('en')).toBe('en-US')
    // Otras variantes regionales mapean al match más cercano.
    expect(normalizeLocale('es-ES')).toBe('es-MX')
    expect(normalizeLocale('en-GB')).toBe('en-US')
    // Locales no soportados → default.
    expect(normalizeLocale('fr-FR')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
  })

  it('createT(locale) recuerda el locale y delega a t()', () => {
    const tEn = createT('en-US')
    const tEs = createT('es-MX')
    expect(tEn('common.logout')).toBe('Sign out')
    expect(tEs('common.logout')).toBe('Cerrar sesión')
  })

  it('paridad estructural: keys principales existen en es-MX y en-US', () => {
    // Test "guardrail" para que la PR no rompa por una key suelta solo en es-MX.
    const sample = [
      'common.loading',
      'buttons.save',
      'buttons.cancel',
      'sidebar.dashboard',
      'sidebar.groups.views',
      'task.status.todo',
      'task.priority.high',
      'filters.title',
      'error.unauthorized',
      'error.forbidden',
      'toast.saved',
      'userMenu.logout',
      // Wave R5E — namespaces nuevos
      'auth.loginTitle',
      'auth.forgotPasswordLink',
      'kanban.headerTitle',
      'pages.list.title',
      'pages.kanban.title',
      'pages.timeline.title',
      'pages.calendar.title',
      'pages.portfolio.title',
      'pages.brain.title',
      'pages.profile.localeTitle',
    ]
    for (const key of sample) {
      expect(t(key, undefined, 'es-MX')).not.toBe(key)
      expect(t(key, undefined, 'en-US')).not.toBe(key)
    }
  })

  it('SUPPORTED_LOCALES contiene exactamente es-MX y en-US (orden estable)', () => {
    expect(SUPPORTED_LOCALES).toEqual(['es-MX', 'en-US'])
  })

  it('getMessages devuelve un objeto serializable con keys conocidas', () => {
    const m = getMessages('es-MX')
    expect(m.common.appName).toBe('Avante Orq PRO')
    const mEn = getMessages('en-US')
    expect(mEn.common.appName).toBe('Avante Orq PRO')
  })

  it('resolveAcceptLanguage parsea headers RFC 7231 con q-weights', () => {
    expect(resolveAcceptLanguage(null)).toBe(DEFAULT_LOCALE)
    expect(resolveAcceptLanguage('')).toBe(DEFAULT_LOCALE)
    // Single preference.
    expect(resolveAcceptLanguage('en-US')).toBe('en-US')
    expect(resolveAcceptLanguage('es-MX')).toBe('es-MX')
    // Short codes via alias.
    expect(resolveAcceptLanguage('es')).toBe('es-MX')
    expect(resolveAcceptLanguage('en')).toBe('en-US')
    // q-weighted: el primer match con mayor q gana.
    expect(resolveAcceptLanguage('fr-FR,en-US;q=0.9,es;q=0.8')).toBe('en-US')
    expect(resolveAcceptLanguage('fr-FR;q=0.9,es-MX;q=1.0')).toBe('es-MX')
    // Unknown → default.
    expect(resolveAcceptLanguage('fr-FR,it;q=0.5')).toBe(DEFAULT_LOCALE)
  })
})
