import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
  currentPath = '/'
  // Reset del store UI antes de cada test (mobileSidebarOpen).
  useUIStore.setState({ mobileSidebarOpen: false })
})

describe('MobileBottomNav', () => {
  it('renderiza los 4 ítems principales', () => {
    render(<MobileBottomNav />)
    expect(screen.getByRole('navigation', { name: /navegación principal/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /tareas/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /gantt/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /más/i })).toBeInTheDocument()
  })

  it('marca el ítem actual con aria-current=page', () => {
    currentPath = '/gantt'
    render(<MobileBottomNav />)
    const gantt = screen.getByRole('link', { name: /gantt/i })
    expect(gantt).toHaveAttribute('aria-current', 'page')
    const dashboard = screen.getByRole('link', { name: /dashboard/i })
    expect(dashboard).not.toHaveAttribute('aria-current')
  })

  it('considera /list como activo cuando estamos en /list, /kanban o /table', () => {
    currentPath = '/kanban'
    render(<MobileBottomNav />)
    const tareas = screen.getByRole('link', { name: /tareas/i })
    expect(tareas).toHaveAttribute('aria-current', 'page')
  })

  it('botón "Más" abre el drawer del sidebar', async () => {
    render(<MobileBottomNav />)
    expect(useUIStore.getState().mobileSidebarOpen).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /más/i }))
    expect(useUIStore.getState().mobileSidebarOpen).toBe(true)
  })

  it('ítems usan href correcto', () => {
    render(<MobileBottomNav />)
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /tareas/i })).toHaveAttribute('href', '/list')
    expect(screen.getByRole('link', { name: /gantt/i })).toHaveAttribute('href', '/gantt')
  })

  it('está oculto en lg+ (clase lg:hidden)', () => {
    render(<MobileBottomNav />)
    const nav = screen.getByTestId('mobile-bottom-nav')
    expect(nav.className).toMatch(/lg:hidden/)
  })
})
