'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ListChecks,
  KanbanSquare,
  CalendarDays,
  Sparkles,
} from 'lucide-react'
import { clsx } from 'clsx'

/**
 * Bottom navigation fija para mobile (Wave P4-3, refinado en P16-C).
 *
 * Visible solo en `<lg` (mobile + tablet pequeño). En desktop el Sidebar
 * cumple el rol de navegación primaria.
 *
 * 4 ítems (P16-C scope · UX Polish):
 *   1. Tareas (List)
 *   2. Kanban
 *   3. Gantt
 *   4. Brain AI
 *
 * Hit area: cada botón ocupa al menos 56x64 px (touch-friendly,
 * supera los 44 px mínimos WCAG/Apple HIG).
 */
type Item = {
  label: string
  href: string
  icon: typeof ListChecks
  matchPaths: string[]
}

const ITEMS: Item[] = [
  {
    label: 'Tareas',
    href: '/list',
    icon: ListChecks,
    matchPaths: ['/list', '/table'],
  },
  {
    label: 'Kanban',
    href: '/kanban',
    icon: KanbanSquare,
    matchPaths: ['/kanban'],
  },
  {
    label: 'Gantt',
    href: '/gantt',
    icon: CalendarDays,
    matchPaths: ['/gantt', '/calendar', '/timeline'],
  },
  {
    label: 'Brain AI',
    href: '/brain',
    icon: Sparkles,
    matchPaths: ['/brain'],
  },
]

function isActive(pathname: string, item: Item): boolean {
  if (item.matchPaths.includes(pathname)) return true
  return item.matchPaths.some((p) => p !== '/' && pathname.startsWith(p))
}

export function MobileBottomNav() {
  const pathname = usePathname() ?? '/'

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
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex flex-1 flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2 py-1 text-[11px] font-medium transition-colors',
              active
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground active:text-foreground',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
