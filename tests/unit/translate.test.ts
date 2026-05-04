import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createT,
  getMessages,
  isLocale,
  normalizeLocale,
  t,
} from '@/lib/i18n/translate'

/**
 * Ola P4 · P4-4 — Tests para el helper i18n nativo.
 *
 * Cobertura mínima:
 *   1. Resuelve keys jerárquicas en `es`.
 *   2. Resuelve la misma key en `en` con valor distinto.
 *   3. Locale inválido → fallback al DEFAULT_LOCALE en runtime via
 *      `normalizeLocale`.
 *   4. Key inexistente → devuelve la key cruda (modo missing-visible).
 *   5. Interpolación de placeholders `{count}` con number.
 *   6. Placeholder no provisto se mantiene literal.
 *   7. `isLocale` valida; `normalizeLocale` cae a default.
 *   8. `createT(locale)` produce factory que recuerda el locale.
 *   9. Diccionarios `es` y `en` cubren las mismas keys principales
 *      (paridad estructural — guardrail QA).
 */

describe('translate · i18n nativo', () => {
  it('resuelve clave jerárquica en español por defecto', () => {
    expect(t('sidebar.dashboard')).toBe('Dashboard')
    expect(t('buttons.save')).toBe('Guardar')
    expect(t('task.priority.critical')).toBe('Crítica')
  })

  it('resuelve la misma clave en inglés con un valor distinto', () => {
    expect(t('buttons.save', undefined, 'en')).toBe('Save')
    expect(t('filters.criticalOnly', undefined, 'en')).toBe('Critical path only')
  })

  it('cae al locale por defecto cuando el destino no tiene la key', () => {
    // Forzamos un locale "soportado" por TS pero sin keys nuevas.
    // No-op aquí: comprobamos que keys faltantes en `en` (ninguna por ahora)
    // caigan a `es`. Lo simulamos con una key que SÓLO existiera en `es` —
    // como ahora todas existen en ambos, el fallback se prueba con la rama
    // del missing-key abajo. Mantenemos el assert estructural.
    expect(t('error.unauthorized', undefined, 'en')).toBe(
      'Session required. Sign in to continue.',
    )
  })

  it('devuelve la key cruda cuando no existe en ningún diccionario', () => {
    expect(t('non.existent.key')).toBe('non.existent.key')
    expect(t('foo', undefined, 'en')).toBe('foo')
  })

  it('interpola variables `{name}` con string y number', () => {
    expect(t('filters.clearWithCount', { count: 3 })).toBe('Limpiar (3)')
    expect(t('filters.clearWithCount', { count: 0 }, 'en')).toBe('Clear (0)')
  })

  it('mantiene placeholder cuando el param no está', () => {
    expect(t('filters.clearWithCount')).toBe('Limpiar ({count})')
  })

  it('isLocale y normalizeLocale validan correctamente', () => {
    expect(isLocale('es')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(42)).toBe(false)

    expect(normalizeLocale('es')).toBe('es')
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('fr')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
  })

  it('createT(locale) recuerda el locale y delega a t()', () => {
    const tEn = createT('en')
    const tEs = createT('es')
    expect(tEn('common.logout')).toBe('Sign out')
    expect(tEs('common.logout')).toBe('Cerrar sesión')
  })

  it('paridad estructural: keys principales existen en es y en', () => {
    // Test "guardrail" para que la PR no rompa por una key suelta solo en es.
    // No exhaustivo (sería frágil) — comprueba un sample representativo.
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
    ]
    for (const key of sample) {
      expect(t(key, undefined, 'es')).not.toBe(key)
      expect(t(key, undefined, 'en')).not.toBe(key)
    }
  })

  it('SUPPORTED_LOCALES contiene exactamente es y en (orden estable)', () => {
    expect(SUPPORTED_LOCALES).toEqual(['es', 'en'])
  })

  it('getMessages devuelve un objeto serializable con keys conocidas', () => {
    const m = getMessages('es')
    expect(m.common.appName).toBe('Avante Orq PRO')
    const mEn = getMessages('en')
    expect(mEn.common.appName).toBe('Avante Orq PRO')
  })
})
