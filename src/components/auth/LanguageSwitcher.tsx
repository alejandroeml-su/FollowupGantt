'use client'

import { useTransition } from 'react'
import { Globe } from 'lucide-react'
import { clsx } from 'clsx'
import { setLocaleAction } from '@/lib/i18n/actions'
import { type Locale, SUPPORTED_LOCALES } from '@/lib/i18n/translate'
import { useTranslation } from '@/lib/i18n/use-translation'

/**
 * Ola P4 · P4-4 — Selector compacto de idioma para `<UserMenu>`.
 *
 * Ubicado en `auth/` por simetría con `UserMenu` y `LogoutButton`.
 * Renderiza dos botones (ES/EN). Al click:
 *   1. Persiste el locale vía server action (`setLocaleAction`).
 *   2. Sincroniza el state cliente con `setLocale` del hook
 *      (que además dispara reload para que server components hidratan
 *      con el nuevo idioma).
 */
export function LanguageSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { locale, setLocale, t } = useTranslation()
  const [isPending, startTransition] = useTransition()

  const labels: Record<Locale, string> = {
    es: 'ES',
    en: 'EN',
  }

  const handleSwitch = (next: Locale) => {
    if (next === locale || isPending) return
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
    <div
      data-testid="language-switcher"
      role="group"
      aria-label={t('userMenu.switchLanguage')}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border border-border bg-background p-0.5',
        collapsed && 'lg:flex-col',
      )}
    >
      <Globe
        className="ml-1 h-3 w-3 text-muted-foreground"
        aria-hidden="true"
      />
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          aria-label={
            l === 'es' ? t('userMenu.languageSpanish') : t('userMenu.languageEnglish')
          }
          disabled={isPending}
          onClick={() => handleSwitch(l)}
          className={clsx(
            'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors',
            locale === l
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {labels[l]}
        </button>
      ))}
    </div>
  )
}
