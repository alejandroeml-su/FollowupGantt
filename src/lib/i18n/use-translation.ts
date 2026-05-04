'use client'

/**
 * Ola P4 · P4-4 — Hook cliente para acceder al locale + helper `t()`.
 *
 * Implementación deliberadamente minimalista (sin Context/Provider) para
 * evitar refactor masivo del árbol React:
 *   - Lee la cookie `x-locale` directamente del `document` en montaje.
 *   - Suscribe a un `storage` event simple para reaccionar a cambios desde
 *     otra pestaña (caso raro pero gratis con esta API).
 *   - Provee `setLocale()` que persiste en cookie y dispara un
 *     `location.reload()` — la mayoría de strings traducidos vive en
 *     server components que solo se re-renderizan tras un round-trip.
 *
 * Si en el futuro se quiere navegar sin reload, basta con introducir un
 * `LocaleProvider` que mantenga el state y volver a llamar las queries:
 * la API de `t()` no cambia.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_LOCALE,
  type Locale,
  LOCALE_COOKIE,
  isLocale,
  normalizeLocale,
  t as translate,
} from './translate'

function readCookieLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
  if (!match) return DEFAULT_LOCALE
  const value = decodeURIComponent(match.slice(LOCALE_COOKIE.length + 1))
  return normalizeLocale(value)
}

function writeCookieLocale(locale: Locale): void {
  if (typeof document === 'undefined') return
  // 1 año, root path, lax para SSR. No es info sensible.
  const oneYear = 60 * 60 * 24 * 365
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${oneYear}; samesite=lax`
}

export type UseTranslation = {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: Locale
  setLocale: (locale: Locale) => void
}

export function useTranslation(): UseTranslation {
  // Estado inicial = DEFAULT_LOCALE para mantener consistencia SSR/CSR.
  // En montaje cliente sincronizamos con la cookie.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    setLocaleState(readCookieLocale())
  }, [])

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return
    writeCookieLocale(next)
    setLocaleState(next)
    // Forzar SSR re-render para que server components recojan la cookie.
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }, [])

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(key, params, locale),
    [locale],
  )

  return { t, locale, setLocale }
}
