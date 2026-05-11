'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  Layers,
  Shield,
  FileStack,
  KeyRound,
  ShieldAlert,
  ArrowLeft,
} from 'lucide-react'

/**
 * Wave P17-C · Sidebar lateral del panel admin. Independiente del
 * Sidebar principal: el layout admin reemplaza el chrome para enfocar
 * al SUPER_ADMIN solo en las acciones de configuración global.
 */

const items: Array<{
  href: string
  label: string
  icon: typeof LayoutDashboard
  description: string
}> = [
  {
    href: '/admin',
    label: 'Resumen',
    icon: LayoutDashboard,
    description: 'Estado general del sistema',
  },
  {
    href: '/admin/workspaces',
    label: 'Workspaces',
    icon: Building2,
    description: 'Catálogo de espacios',
  },
  {
    href: '/admin/gerencias',
    label: 'Gerencias',
    icon: Layers,
    description: 'Estructura organizacional',
  },
  {
    href: '/admin/roles',
    label: 'Roles & Permisos',
    icon: Shield,
    description: 'Matriz de permisos y asignación',
  },
  {
    href: '/admin/templates',
    label: 'Plantillas',
    icon: FileStack,
    description: 'Catálogo global',
  },
  {
    href: '/admin/sso',
    label: 'SSO / SAML',
    icon: KeyRound,
    description: 'Identidad federada por workspace',
  },
  {
    href: '/admin/retention',
    label: 'Retention',
    icon: ShieldAlert,
    description: 'Políticas de purge',
  },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="flex h-full w-64 flex-col border-r border-border bg-card/40"
      aria-label="Navegación de Admin"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <Shield className="h-5 w-5 text-amber-400" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Admin Panel
        </h2>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {items.map((it) => {
            const active =
              it.href === '/admin'
                ? pathname === '/admin'
                : pathname.startsWith(it.href)
            const Icon = it.icon
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={[
                    'group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors',
                    active
                      ? 'bg-amber-500/15 text-amber-200'
                      : 'text-foreground/80 hover:bg-subtle hover:text-foreground',
                  ].join(' ')}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon
                    className={[
                      'mt-0.5 h-4 w-4 flex-shrink-0',
                      active ? 'text-amber-400' : 'text-muted-foreground',
                    ].join(' ')}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-tight">
                      {it.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {it.description}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3">
        <Link
          href="/"
          className="group flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Volver a la app</span>
        </Link>
      </div>
    </aside>
  )
}
