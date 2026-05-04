import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Ola P5 · Equipo D1 — Tests del Sidebar consolidado.
 *
 * Estrategia de mocks:
 *   - `next/navigation` controla el `pathname` para validar el highlight
 *     activo y la apertura inicial del grupo correspondiente.
 *   - `next/link` se aplana a `<a>` para que userEvent pueda click sin
 *     necesitar un Router de Next.
 *   - Las server actions de notificaciones se stubean (el Sidebar monta
 *     `<NotificationsBell/>` en su footer).
 *   - `useTranslation` se mockea con un dispatcher por locale: cada test
 *     puede mutar `currentLocale` y obtener strings ES o EN sin tocar
 *     cookies del DOM (la implementación real lee `document.cookie` en
 *     `useEffect`, lo que es inestable bajo jsdom). El mock importa el
 *     `t` puro del módulo `translate.ts`, que es lo único que valida
 *     este test (paridad ES/EN).
 */

// ── Mocks ──────────────────────────────────────────────────────────

let currentPath = '/'
let currentLocale: 'es' | 'en' = 'es'

vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

vi.mock('@/lib/actions/notifications', () => ({
  getNotificationsForCurrentUser: vi.fn().mockResolvedValue([]),
  getUnreadCount: vi.fn().mockResolvedValue(0),
  markAllNotificationsRead: vi.fn().mockResolvedValue({ count: 0 }),
  markNotificationRead: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/i18n/use-translation', async () => {
  const real = await vi.importActual<typeof import('@/lib/i18n/translate')>(
    '@/lib/i18n/translate',
  )
  return {
    useTranslation: () => ({
      t: (key: string, params?: Record<string, string | number>) =>
        real.t(key, params, currentLocale),
      locale: currentLocale,
      setLocale: vi.fn(),
    }),
  }
})

// SUT — importa después de los vi.mock para que tome los stubs.
import Sidebar from '@/components/Sidebar'
import { useUIStore } from '@/lib/stores/ui'

beforeEach(() => {
  currentPath = '/'
  currentLocale = 'es'
  useUIStore.setState({
    mobileSidebarOpen: false,
    sidebarCollapsed: false,
  })
})

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Click en el botón "AGENTE" del Debug Role Switcher para ejercitar el
 * filtrado real (sin necesidad de auth real). Mantiene el test cerca
 * del comportamiento que el QA verifica manualmente.
 */
async function switchToAgente() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /AGENTE/i }))
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Sidebar · estructura básica', () => {
  it('renderiza la nav principal con al menos un grupo', () => {
    render(<Sidebar />)
    const nav = screen.getByTestId('sidebar-nav')
    expect(nav).toBeInTheDocument()
    // SUPER_ADMIN ve todos los grupos.
    expect(screen.getByRole('button', { name: /Estrategia/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Operación/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Configuración/i })).toBeInTheDocument()
  })

  it('expone los items top-level visibles (Pizarras, Notificaciones, Tareas)', () => {
    render(<Sidebar />)
    expect(screen.getByRole('link', { name: /Pizarras/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Notificaciones/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tareas/i })).toBeInTheDocument()
    // Match exacto para no chocar con "Dashboards KPI".
    expect(screen.getByRole('link', { name: /^Dashboard$/i })).toBeInTheDocument()
  })
})

describe('Sidebar · filtrado por rol', () => {
  it('AGENTE oculta los grupos Configuración y Workspace', async () => {
    render(<Sidebar />)
    // Sanity: SUPER_ADMIN sí los ve.
    expect(screen.getByRole('button', { name: /Configuración/i })).toBeInTheDocument()

    await switchToAgente()

    expect(screen.queryByRole('button', { name: /Configuración/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Workspace/i })).toBeNull()
    // Pero conserva Estrategia y Operación.
    expect(screen.getByRole('button', { name: /Estrategia/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Operación/i })).toBeInTheDocument()
  })

  it('ADMIN ve Configuración pero no items SUPER_ADMIN-only (Tokens API, Backup)', async () => {
    render(<Sidebar />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^ADMIN$/i }))

    // El grupo Configuración sigue visible…
    const settingsHeader = screen.getByRole('button', { name: /Configuración/i })
    expect(settingsHeader).toBeInTheDocument()
    // Lo abrimos para que sus items entren al DOM accesible.
    await user.click(settingsHeader)

    // …pero los items SUPER_ADMIN-only desaparecen.
    expect(screen.queryByRole('link', { name: /Tokens API/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /Backup/i })).toBeNull()
    // Mientras que items ADMIN-friendly siguen presentes.
    expect(screen.getByRole('link', { name: /Roles & Permisos/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Integraciones/i })).toBeInTheDocument()
  })
})

describe('Sidebar · navegación y active state', () => {
  it('los items renderizan con href correcto (Link mock)', () => {
    render(<Sidebar />)
    const dashboard = screen.getByRole('link', { name: /^Dashboard$/i })
    expect(dashboard).toHaveAttribute('href', '/')

    const whiteboards = screen.getByRole('link', { name: /Pizarras/i })
    expect(whiteboards).toHaveAttribute('href', '/whiteboards')
  })

  it('marca aria-current=page en el path activo y trata /list como activo en /kanban', () => {
    currentPath = '/kanban'
    render(<Sidebar />)
    const tareas = screen.getByRole('link', { name: /Tareas/i })
    expect(tareas).toHaveAttribute('aria-current', 'page')

    // Dashboard no debe iluminarse cuando estamos fuera de "/".
    const dashboard = screen.getByRole('link', { name: /^Dashboard$/i })
    expect(dashboard).not.toHaveAttribute('aria-current')
  })
})

describe('Sidebar · drawer mobile', () => {
  it('expone el botón hamburguesa/colapsar (icono Menu visible cuando colapsado)', () => {
    useUIStore.setState({ sidebarCollapsed: true })
    render(<Sidebar />)
    // El botón de colapso siempre está; el aria-label cambia entre
    // "Expandir menú" (cuando colapsado) y "Colapsar menú".
    expect(
      screen.getByRole('button', { name: /Expandir menú/i }),
    ).toBeInTheDocument()
  })
})

describe('Sidebar · i18n', () => {
  it('renderiza "Pizarras" en locale ES y "Whiteboards" en locale EN', () => {
    currentLocale = 'es'
    const { unmount } = render(<Sidebar />)
    expect(screen.getByRole('link', { name: /Pizarras/i })).toBeInTheDocument()
    unmount()

    currentLocale = 'en'
    render(<Sidebar />)
    expect(screen.getByRole('link', { name: /Whiteboards/i })).toBeInTheDocument()
  })
})

describe('Sidebar · items consolidados P3/P4/P5', () => {
  it('expone Insights AI, Reportes ejecutivos y Nivelación de recursos', async () => {
    render(<Sidebar />)
    const user = userEvent.setup()

    // Estrategia (cerrado por defecto en "/" porque ningún hijo activa)
    await user.click(screen.getByRole('button', { name: /Estrategia/i }))
    expect(screen.getByRole('link', { name: /Reportes ejecutivos/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Insights AI/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Insights AI/i })).toHaveAttribute(
      'href',
      '/insights',
    )

    // Operación → Nivelación.
    await user.click(screen.getByRole('button', { name: /Operación/i }))
    const leveling = screen.getByRole('link', { name: /Nivelación de recursos/i })
    expect(leveling).toBeInTheDocument()
    expect(leveling).toHaveAttribute('href', '/leveling')
  })

  it('expone Integraciones, Formularios públicos y Automatizaciones admin en Configuración', async () => {
    render(<Sidebar />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Configuración/i }))

    expect(screen.getByRole('link', { name: /Integraciones/i })).toHaveAttribute(
      'href',
      '/settings/integrations',
    )
    expect(screen.getByRole('link', { name: /Formularios públicos/i })).toHaveAttribute(
      'href',
      '/settings/forms',
    )
    // El item admin de Automatizaciones (settings/automation) además del
    // top-level /automations expuesto en Gestión.
    const automationsAdminLinks = screen
      .getAllByRole('link', { name: /Automatizaciones/i })
      .map((el) => el.getAttribute('href'))
    expect(automationsAdminLinks).toContain('/settings/automation')
  })

  it('expone el grupo Workspace con Workspaces, Miembros e Invitaciones', async () => {
    render(<Sidebar />)
    const user = userEvent.setup()
    const workspaceHeader = screen.getByRole('button', { name: /Workspace/i })
    expect(workspaceHeader).toBeInTheDocument()
    await user.click(workspaceHeader)

    const group = workspaceHeader.closest('[data-testid^="sidebar-group-"]')!
    const scoped = within(group as HTMLElement)
    expect(scoped.getByRole('link', { name: /Workspaces/i })).toHaveAttribute(
      'href',
      '/settings/workspace',
    )
    expect(scoped.getByRole('link', { name: /Miembros/i })).toHaveAttribute(
      'href',
      '/settings/workspace/members',
    )
    expect(scoped.getByRole('link', { name: /Invitaciones pendientes/i })).toBeInTheDocument()
  })
})
