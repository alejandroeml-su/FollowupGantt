import { User as UserIcon } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import { logoutAction } from '@/lib/auth/actions'
import { getServerT } from '@/lib/i18n/server'
import LogoutButton from './LogoutButton'
import { LanguageSwitcher } from './LanguageSwitcher'

/**
 * Dropdown / footer mínimo del usuario autenticado.
 *
 * Server component: lee la sesión vía `getCurrentUser()`. Si no hay
 * sesión devuelve `null` (el Sidebar muestra otro estado en su footer).
 *
 * La acción de logout se renderiza como un form que invoca el server
 * action `logoutAction` — esto evita necesitar JavaScript del cliente
 * para algo tan simple.
 *
 * Ola P4 · P4-4 — embebe `<LanguageSwitcher>` y traduce los aria-labels
 * usando el helper SSR `getServerT()`. El selector es client component
 * (necesita interactividad), pero todo el chrome estático del menú se
 * resuelve en server.
 */
export default async function UserMenu({
  collapsed = false,
}: {
  collapsed?: boolean
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const t = await getServerT()

  const initials = (user.name || user.email)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')

  const primaryRole = user.roles[0] ?? 'AGENTE'

  return (
    <div data-testid="user-menu" className="flex flex-col gap-2">
      <div
        className="flex items-center gap-3 rounded-lg bg-accent/40 border border-border/50 px-2 py-2"
        title={collapsed ? `${user.name} — ${primaryRole}` : undefined}
      >
        <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold text-primary-foreground shadow-md flex-shrink-0">
          {initials || <UserIcon className="h-4 w-4" />}
        </div>
        {!collapsed && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="text-xs font-medium text-foreground truncate">
              {user.name}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">
              {primaryRole}
            </span>
          </div>
        )}
        <form action={logoutAction} aria-label={t('userMenu.logout')}>
          <LogoutButton />
        </form>
      </div>
      {/* Selector de idioma — visible siempre, también en sidebar colapsada
          para que el usuario pueda alternar sin expandir el menú. */}
      <div className="flex items-center justify-end px-1">
        <LanguageSwitcher collapsed={collapsed} />
      </div>
    </div>
  )
}

// Re-export del action para que componentes cliente puedan importarlo
// directamente desde este archivo si lo necesitan.
export { logoutAction }
