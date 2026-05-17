'use client'

/**
 * Wave R5E (2026-05-17) — Sección de "Idioma de la interfaz" dentro de
 * `/settings/profile`. Selector dropdown con las dos variantes BCP-47
 * soportadas (`es-MX` por defecto + `en-US`). Al cambiar:
 *   1. Persiste la cookie `x-locale` vía server action (`setLocaleAction`).
 *   2. Llama al setter cliente del hook `useTranslation`, que dispara
 *      `location.reload()` para que server components recojan el cookie.
 *
 * El hook `useTranslation` ya reload-ea — aquí solo coordinamos el
 * pending state durante la transición. El sidebar tiene un toggle
 * compacto (`<LanguageSwitcher/>`) pero los criterios de aceptación de
 * Wave R5E piden un selector con etiqueta completa en /settings/profile.
 */

import { useTransition } from 'react'
import { Globe } from 'lucide-react'
import { setLocaleAction } from '@/lib/i18n/actions'
import { useTranslation } from '@/lib/i18n/use-translation'
import { type Locale, SUPPORTED_LOCALES } from '@/lib/i18n/translate'

export function ProfileLocaleSection() {
  const { locale, setLocale, t } = useTranslation()
  const [isPending, startTransition] = useTransition()

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as Locale
    if (next === locale || isPending) return
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(next)) return
    startTransition(async () => {
      try {
        await setLocaleAction(next)
      } catch {
        // si la server action falla seguimos con el cookie cliente —
        // SSR mostrará el default hasta que vuelva a estar disponible.
      }
      setLocale(next)
    })
  }

  return (
    <section
      data-testid="profile-locale-section"
      aria-labelledby="profile-locale-title"
      className="rounded-2xl border border-border bg-card p-6"
    >
      <h2
        id="profile-locale-title"
        className="flex items-center gap-2 text-lg font-semibold text-foreground"
      >
        <Globe className="h-5 w-5 text-indigo-400" aria-hidden="true" />
        {t('pages.profile.localeTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('pages.profile.localeBody')}
      </p>

      <div className="mt-4 max-w-xs">
        <label
          htmlFor="profile-locale-select"
          className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          {t('pages.profile.localeSelectLabel')}
        </label>
        <select
          id="profile-locale-select"
          data-testid="profile-locale-select"
          aria-label={t('userMenu.switchLanguage')}
          value={locale}
          onChange={handleChange}
          disabled={isPending}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
        >
          <option value="es-MX">{t('userMenu.languageSpanish')}</option>
          <option value="en-US">{t('userMenu.languageEnglish')}</option>
        </select>
        <p className="mt-2 text-xs text-muted-foreground">
          {isPending
            ? t('pages.profile.localeSaving')
            : t('pages.profile.localeReloadHint')}
        </p>
      </div>
    </section>
  )
}
