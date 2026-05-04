'use client'

import { LogOut } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/use-translation'

/**
 * Botón cliente que envía el form padre. Se separa del UserMenu (server)
 * para mantener el dropdown del usuario como server component sin
 * arrastrar lucide-react al server bundle innecesariamente.
 *
 * Ola P4 · P4-4 — `title`/`aria-label` se traducen via `useTranslation`.
 */
export default function LogoutButton() {
  const { t } = useTranslation()
  const label = t('userMenu.logout')
  return (
    <button
      type="submit"
      data-testid="logout-button"
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <LogOut className="h-4 w-4" />
    </button>
  )
}
