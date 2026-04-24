'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'
import { hrefWithFilters, pickFilters } from '@/lib/filters'

const LABELS: Record<string, string> = {
  list: 'Lista',
  kanban: 'Kanban',
  gantt: 'Gantt',
  calendar: 'Calendar',
  table: 'Tabla',
  workload: 'Workload',
  projects: 'Proyectos',
  gerencias: 'Gerencias',
  mindmaps: 'Mindmaps',
  whiteboards: 'Whiteboards',
  brain: 'Brain',
  forms: 'Forms',
  docs: 'Docs',
  dashboards: 'Dashboards',
  automations: 'Automations',
}

/**
 * Breadcrumbs generados a partir del pathname actual, preservando
 * filtros en los enlaces. Se monta en la parte superior del header de
 * cualquier vista.
 */
export function GlobalBreadcrumbs() {
  const pathname = usePathname()
  const sp = useSearchParams()
  const filters = pickFilters(sp)

  const segments = pathname.split('/').filter(Boolean)
  const crumbs = segments.map((seg, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/')
    const label = LABELS[seg] ?? seg
    return { href, label }
  })

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-xs text-slate-400"
    >
      <Link
        href={hrefWithFilters('/', filters)}
        className="flex items-center gap-1 hover:text-slate-200"
        aria-label="Inicio"
      >
        <Home className="h-3 w-3" />
      </Link>
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 text-slate-600" aria-hidden />
          {i === crumbs.length - 1 ? (
            <span aria-current="page" className="font-medium text-slate-200">
              {c.label}
            </span>
          ) : (
            <Link
              href={hrefWithFilters(c.href, filters)}
              className="hover:text-slate-200"
            >
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
