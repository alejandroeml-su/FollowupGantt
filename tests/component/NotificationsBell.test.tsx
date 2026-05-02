import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Ola P1 · Tests del Bell + Dropdown.
 *
 * Mockeamos las server actions para evitar tocar BD/Next runtime y poder
 * controlar el estado del componente. El Dropdown se monta cuando el
 * usuario hace click sobre el botón.
 */

const getNotificationsForCurrentUser = vi.fn()
const getUnreadCount = vi.fn()
const markAllNotificationsRead = vi.fn()
const markNotificationRead = vi.fn()

vi.mock('@/lib/actions/notifications', () => ({
  getNotificationsForCurrentUser: (...args: unknown[]) =>
    getNotificationsForCurrentUser(...args),
  getUnreadCount: (...args: unknown[]) => getUnreadCount(...args),
  markAllNotificationsRead: (...args: unknown[]) =>
    markAllNotificationsRead(...args),
  markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
}))

import { NotificationsBell } from '@/components/notifications/NotificationsBell'

beforeEach(() => {
  getNotificationsForCurrentUser.mockReset()
  getUnreadCount.mockReset()
  markAllNotificationsRead.mockReset()
  markNotificationRead.mockReset()

  getNotificationsForCurrentUser.mockResolvedValue([])
  getUnreadCount.mockResolvedValue(0)
  markAllNotificationsRead.mockResolvedValue({ count: 0 })
  markNotificationRead.mockResolvedValue({ id: 'x', readAt: new Date().toISOString() })
})

describe('NotificationsBell', () => {
  it('renderiza el botón sin badge cuando no hay no-leídas', () => {
    render(<NotificationsBell enablePolling={false} initialCount={0} />)
    expect(screen.getByTestId('notifications-bell')).toBeInTheDocument()
    expect(screen.queryByTestId('notifications-bell-badge')).toBeNull()
  })

  it('muestra el badge con el count cuando hay no-leídas', () => {
    render(<NotificationsBell enablePolling={false} initialCount={5} />)
    const badge = screen.getByTestId('notifications-bell-badge')
    expect(badge).toHaveTextContent('5')
  })

  it('clamp del badge a "99+" cuando hay >99', () => {
    render(<NotificationsBell enablePolling={false} initialCount={150} />)
    expect(screen.getByTestId('notifications-bell-badge')).toHaveTextContent('99+')
  })

  it('al click abre el dropdown, lista items y permite marcar todas', async () => {
    getNotificationsForCurrentUser.mockResolvedValue([
      {
        id: 'n1',
        userId: 'edwin',
        type: 'MENTION',
        title: 'Te mencionaron en Tarea X',
        body: 'Mira esto cuando puedas',
        link: '/list?taskId=t1',
        data: null,
        readAt: null,
        createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
      },
      {
        id: 'n2',
        userId: 'edwin',
        type: 'IMPORT_COMPLETED',
        title: 'Import Excel completado',
        body: '120 tareas, 0 advertencias',
        link: '/gantt',
        data: null,
        readAt: null,
        createdAt: new Date('2026-05-01T09:00:00Z').toISOString(),
      },
    ])
    markAllNotificationsRead.mockResolvedValue({ count: 2 })

    render(<NotificationsBell enablePolling={false} initialCount={2} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('notifications-bell'))

    // Dropdown abierto.
    expect(await screen.findByTestId('notifications-dropdown')).toBeInTheDocument()
    // Esperamos a que termine el fetch y aparezcan los items.
    await waitFor(() => {
      expect(screen.getAllByTestId('notifications-item')).toHaveLength(2)
    })
    expect(screen.getByText(/Te mencionaron en Tarea X/)).toBeInTheDocument()

    // Marcar todas leídas.
    await user.click(screen.getByTestId('notifications-mark-all'))
    expect(markAllNotificationsRead).toHaveBeenCalledOnce()

    // Después de la acción, el badge desaparece (count=0).
    await waitFor(() => {
      expect(screen.queryByTestId('notifications-bell-badge')).toBeNull()
    })
  })

  it('muestra empty state cuando no hay notificaciones tras abrir', async () => {
    getNotificationsForCurrentUser.mockResolvedValue([])

    render(<NotificationsBell enablePolling={false} initialCount={0} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('notifications-bell'))

    expect(await screen.findByTestId('notifications-empty')).toHaveTextContent(
      /Sin notificaciones/i,
    )
  })

  it('botón "Marcar como leídas" está deshabilitado si no hay no-leídas', async () => {
    getNotificationsForCurrentUser.mockResolvedValue([
      {
        id: 'n1',
        userId: 'edwin',
        type: 'MENTION',
        title: 'Vieja mención',
        body: null,
        link: null,
        data: null,
        readAt: new Date('2026-04-30T10:00:00Z').toISOString(),
        createdAt: new Date('2026-04-30T10:00:00Z').toISOString(),
      },
    ])

    render(<NotificationsBell enablePolling={false} initialCount={0} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('notifications-bell'))

    await waitFor(() => {
      expect(screen.getByTestId('notifications-mark-all')).toBeDisabled()
    })
    expect(markAllNotificationsRead).not.toHaveBeenCalled()
  })

  it('al cargar inicial sin initialCount llama a getUnreadCount', async () => {
    getUnreadCount.mockResolvedValue(4)
    render(<NotificationsBell enablePolling={false} />)
    await waitFor(() => {
      expect(screen.getByTestId('notifications-bell-badge')).toHaveTextContent('4')
    })
    expect(getUnreadCount).toHaveBeenCalledOnce()
  })
})

describe('NotificationsBell · accesibilidad', () => {
  it('aria-label refleja el conteo cuando hay no-leídas', () => {
    render(<NotificationsBell enablePolling={false} initialCount={3} />)
    const btn = screen.getByTestId('notifications-bell')
    expect(btn).toHaveAttribute('aria-label', expect.stringMatching(/3 sin leer/))
  })

  it('aria-expanded se actualiza al abrir el dropdown', async () => {
    render(<NotificationsBell enablePolling={false} initialCount={0} />)
    const btn = screen.getByTestId('notifications-bell')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await act(async () => {
      await userEvent.click(btn)
    })
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })
})
