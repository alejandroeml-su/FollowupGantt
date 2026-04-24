'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { clsx } from 'clsx'
import {
  LayoutList,
  Kanban,
  GanttChart,
  Calendar as CalIcon,
  Table as TableIcon,
} from 'lucide-react'
import { hrefWithFilters, pickFilters } from '@/lib/filters'

const VIEWS = [
  { href: '/list', label: 'List', icon: LayoutList },
  { href: '/kanban', label: 'Kanban', icon: Kanban },
  { href: '/gantt', label: 'Gantt', icon: GanttChart },
  { href: '/calendar', label: 'Calendar', icon: CalIcon },
  { href: '/table', label: 'Table', icon: TableIcon },
] as const

/**
 * Switch de vistas que preserva los filtros aplicados en la URL actual.
 * Útil renderizar en headers de cada vista o en la Sidebar.
 */
export function ViewSwitcher() {
  const pathname = usePathname()
  const sp = useSearchParams()
  const filters = pickFilters(sp)

  return (
    <nav
      role="tablist"
      aria-label="Cambiar vista"
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 p-1"
    >
      {VIEWS.map((v) => {
        const active = pathname.startsWith(v.href)
        const Icon = v.icon
        return (
          <Link
            key={v.href}
            role="tab"
            aria-selected={active}
            href={hrefWithFilters(v.href, filters)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {v.label}
          </Link>
        )
      })}
    </nav>
  )
}
