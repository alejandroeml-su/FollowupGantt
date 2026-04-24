import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Usaremos mocks locales por test para variar pathname/searchParams
let currentPath = '/list'
let currentSearch = new URLSearchParams()

vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
  useSearchParams: () => currentSearch,
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock de next/link para renderizar <a> plano
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'

beforeEach(() => {
  currentPath = '/list'
  currentSearch = new URLSearchParams()
})

describe('ViewSwitcher', () => {
  it('marca la vista actual como seleccionada', () => {
    currentPath = '/kanban'
    render(<ViewSwitcher />)
    const tab = screen.getByRole('tab', { name: /Kanban/i })
    expect(tab).toHaveAttribute('aria-selected', 'true')
  })

  it('preserva filtros comunes al cambiar de vista', () => {
    currentPath = '/list'
    currentSearch = new URLSearchParams('status=TODO&assignee=u1')
    render(<ViewSwitcher />)
    const kanban = screen.getByRole('tab', { name: /Kanban/i }) as HTMLAnchorElement
    expect(kanban.getAttribute('href')).toContain('status=TODO')
    expect(kanban.getAttribute('href')).toContain('assignee=u1')
  })

  it('descarta `month` al navegar a vistas distintas a /gantt', () => {
    currentPath = '/gantt'
    currentSearch = new URLSearchParams('month=2026-05&status=DONE')
    render(<ViewSwitcher />)
    const list = screen.getByRole('tab', { name: /List/i }) as HTMLAnchorElement
    expect(list.getAttribute('href')).not.toContain('month=')
    expect(list.getAttribute('href')).toContain('status=DONE')
  })

  it('mantiene `month` al navegar a /gantt', () => {
    currentPath = '/list'
    currentSearch = new URLSearchParams('month=2026-05')
    render(<ViewSwitcher />)
    const gantt = screen.getByRole('tab', { name: /Gantt/i }) as HTMLAnchorElement
    expect(gantt.getAttribute('href')).toContain('month=2026-05')
  })
})
