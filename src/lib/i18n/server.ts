import 'server-only'
import { cookies } from 'next/headers'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
  createT,
  normalizeLocale,
} from './translate'

/**
 * Ola P4 · P4-4 — Helpers de i18n para server components / actions.
 *
 * Aislados aquí (no en `translate.ts`) para que el módulo puro no
 * arrastre `next/headers` (que rompe en client bundles).
 *
 * Uso típico en una page server-side:
 *
 *   ```tsx
 *   import { getServerLocale, getServerT } from '@/lib/i18n/server'
 *   export default async function Page() {
 *     const t = await getServerT()
 *     return <h1>{t('pages.dashboard.title')}</h1>
 *   }
 *   ```
 */

export async function getServerLocale(): Promise<Locale> {
  try {
    const store = await cookies()
    const value = store.get(LOCALE_COOKIE)?.value
    return normalizeLocale(value)
  } catch {
    // En contextos donde `cookies()` no está disponible (p. ej. ciertas
    // utilidades llamadas fuera de request) caemos al default.
    return DEFAULT_LOCALE
  }
}

export async function getServerT() {
  const locale = await getServerLocale()
  return createT(locale)
}
