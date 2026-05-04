'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ListChecks, CalendarDays, MoreHorizontal } from 'lucide-react'
import { clsx } from 'clsx'
import { useUIStore } from '@/lib/stores/ui'

/**
 * Bottom navigation fija para mobile (P4-3).
 *
 * Visible solo en `<lg` (mobile + tablet pequeño). En desktop el Sidebar
 * cumple el rol de navegación primaria.
 *
 * 4 ítems: Dashboard, Tareas (lista), Gantt, Más (abre el drawer del
 * sidebar completo con todas las secciones secundarias).
 *
 * Hit area: cada botón ocupa al menos 56x56 px (touch-friendly, supera
 * los 44 px mínimos WCAG/Apple HIG).
 */
type Item = {
  label: string
  href?: string
  icon: typeof LayoutDashboard
  matchPaths?: string[]
}

const ITEMS: Item[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, matchPaths: ['/'] },
  { label: 'Tareas', href: '/list', icon: ListChecks, matchPaths: ['/list', '/kanban', '/table'] },
  { label: 'Gantt', href: '/gantt', icon: CalendarDays, matchPaths: ['/gantt', '/calendar'] },
  // Sin href → abre el drawer del sidebar completo.
  { label: 'Más', icon: MoreHorizontal },
]

function isActive(pathname: string, item: Item): boolean {
  if (!item.matchPaths) return false
  if (item.matchPaths.includes(pathname)) return true
  // Coincidencia por prefijo para subrutas como /list/123 o /gantt?month=
  return item.matchPaths.some((p) => p !== '/' && pathname.startsWith(p))
}

export function MobileBottomNav() {
  const pathname = usePathname() ?? '/'
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen)

  return (
    <nav
      aria-label="Navegación principal"
      role="navigation"
      data-testid="mobile-bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-stretch border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon
        const active = isActive(pathname, item)
        const baseClass = clsx(
          'flex flex-1 flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2 py-1 text-[11px] font-medium transition-colors',
          active
            ? 'text-primary'
            : 'text-muted-foreground hover:text-foreground active:text-foreground',
        )

        if (item.href) {
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={baseClass}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          )
        }

        return (
          <button
            key={item.label}
            type="button"
            aria-label={item.label}
            onClick={() => setMobileOpen(true)}
            className={baseClass}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
