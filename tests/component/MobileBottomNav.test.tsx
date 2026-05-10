import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let currentPath = '/'

vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { MobileBottomNav } from '@/components/mobile/MobileBottomNav'
import { useUIStore } from '@/lib/stores/ui'

beforeEach(() => {
  currentPath = '/list'
  // Reset del store UI antes de cada test (mobileSidebarOpen).
  useUIStore.setState({ mobileSidebarOpen: false })
})

describe('MobileBottomNav', () => {
  it('renderiza los 4 ítems principales (Tareas, Kanban, Gantt, Brain AI)', () => {
    render(<MobileBottomNav />)
    expect(
      screen.getByRole('navigation', { name: /navegación principal/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /tareas/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /kanban/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /gantt/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /brain ai/i })).toBeInTheDocument()
  })

  it('marca el ítem actual con aria-current=page', () => {
    currentPath = '/gantt'
    render(<MobileBottomNav />)
    const gantt = screen.getByRole('link', { name: /gantt/i })
    expect(gantt).toHaveAttribute('aria-current', 'page')
    const tareas = screen.getByRole('link', { name: /tareas/i })
    expect(tareas).not.toHaveAttribute('aria-current')
  })

  it('Tareas activo en /list o /table', () => {
    currentPath = '/table'
    render(<MobileBottomNav />)
    const tareas = screen.getByRole('link', { name: /tareas/i })
    expect(tareas).toHaveAttribute('aria-current', 'page')
  })

  it('Gantt activo en /gantt, /calendar, /timeline', () => {
    currentPath = '/timeline'
    render(<MobileBottomNav />)
    const gantt = screen.getByRole('link', { name: /gantt/i })
    expect(gantt).toHaveAttribute('aria-current', 'page')
  })

  it('ítems usan href correcto', () => {
    render(<MobileBottomNav />)
    expect(screen.getByRole('link', { name: /tareas/i })).toHaveAttribute(
      'href',
      '/list',
    )
    expect(screen.getByRole('link', { name: /kanban/i })).toHaveAttribute(
      'href',
      '/kanban',
    )
    expect(screen.getByRole('link', { name: /gantt/i })).toHaveAttribute(
      'href',
      '/gantt',
    )
    expect(screen.getByRole('link', { name: /brain ai/i })).toHaveAttribute(
      'href',
      '/brain',
    )
  })

  it('está oculto en lg+ (clase lg:hidden)', () => {
    render(<MobileBottomNav />)
    const nav = screen.getByTestId('mobile-bottom-nav')
    expect(nav.className).toMatch(/lg:hidden/)
  })

  it('hit area cumple WCAG (min-h-[44px])', () => {
    render(<MobileBottomNav />)
    const tareas = screen.getByRole('link', { name: /tareas/i })
    expect(tareas.className).toMatch(/min-h-\[44px\]/)
  })
})
