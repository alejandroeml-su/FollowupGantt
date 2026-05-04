import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const queryAuditEventsMock = vi.fn()

vi.mock('@/lib/actions/audit', () => ({
  queryAuditEvents: (...args: unknown[]) => queryAuditEventsMock(...args),
}))

import { TaskAuditHistorySection } from '@/components/tasks/TaskAuditHistorySection'

beforeEach(() => {
  queryAuditEventsMock.mockReset()
  queryAuditEventsMock.mockResolvedValue({ items: [], nextCursor: null })
})

describe('TaskAuditHistorySection', () => {
  it('renderiza colapsada por defecto y NO consulta hasta abrirla', () => {
    render(<TaskAuditHistorySection taskId="t1" />)
    const button = screen.getByRole('button', { name: /Auditoría/i })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(queryAuditEventsMock).not.toHaveBeenCalled()
  })

  it('al click consulta queryAuditEvents con entityType="task" y limit=10', async () => {
    const user = userEvent.setup()
    render(<TaskAuditHistorySection taskId="t1" />)
    await user.click(screen.getByRole('button', { name: /Auditoría/i }))
    await waitFor(() => {
      expect(queryAuditEventsMock).toHaveBeenCalledWith({
        entityType: 'task',
        entityId: 't1',
        limit: 10,
      })
    })
  })

  it('muestra empty state amistoso cuando no hay eventos', async () => {
    render(
      <TaskAuditHistorySection
        taskId="t1"
        defaultOpen
        preloadedEvents={[]}
      />,
    )
    expect(
      await screen.findByTestId('task-audit-empty'),
    ).toHaveTextContent(/no hay eventos/i)
  })

  it('renderiza filas con actor, fecha y acción legibles', async () => {
    render(
      <TaskAuditHistorySection
        taskId="t1"
        defaultOpen
        preloadedEvents={[
          {
            id: 'a1',
            actorId: 'u1',
            actorName: 'Edwin',
            actorEmail: 'e@avante.mx',
            action: 'task.updated',
            entityType: 'task',
            entityId: 't1',
            before: { status: 'TODO' },
            after: { status: 'IN_PROGRESS' },
            ipAddress: null,
            userAgent: null,
            metadata: { summary: 'Cambio de estado' },
            createdAt: new Date('2026-04-29T10:00:00Z').toISOString(),
          },
        ]}
      />,
    )
    expect(screen.getByTestId('task-audit-row-a1')).toBeInTheDocument()
    expect(screen.getByText(/Tarea actualizada/i)).toBeInTheDocument()
    expect(screen.getByText(/Edwin/)).toBeInTheDocument()
    expect(screen.getByText(/Cambio de estado/i)).toBeInTheDocument()
  })

  it('expande para mostrar before/after en JSON', async () => {
    const user = userEvent.setup()
    render(
      <TaskAuditHistorySection
        taskId="t1"
        defaultOpen
        preloadedEvents={[
          {
            id: 'a2',
            actorId: null,
            actorName: null,
            actorEmail: null,
            action: 'task.created',
            entityType: 'task',
            entityId: 't1',
            before: null,
            after: { title: 'Nueva tarea' },
            ipAddress: null,
            userAgent: null,
            metadata: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    )
    const summary = screen.getByText(/Tarea creada/i)
    await user.click(summary)
    expect(screen.getByText(/"title": "Nueva tarea"/)).toBeInTheDocument()
    expect(screen.getAllByText('Antes')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Después')[0]).toBeInTheDocument()
  })

  it('cae a "Sistema" cuando no hay actor', () => {
    render(
      <TaskAuditHistorySection
        taskId="t1"
        defaultOpen
        preloadedEvents={[
          {
            id: 'a3',
            actorId: null,
            actorName: null,
            actorEmail: null,
            action: 'task.deleted',
            entityType: 'task',
            entityId: 't1',
            before: null,
            after: null,
            ipAddress: null,
            userAgent: null,
            metadata: null,
            createdAt: new Date().toISOString(),
          },
        ]}
      />,
    )
    expect(screen.getByText(/Sistema/)).toBeInTheDocument()
  })

  it('reporta error si queryAuditEvents falla', async () => {
    queryAuditEventsMock.mockRejectedValueOnce(
      new Error('[FORBIDDEN] no autorizado'),
    )
    const user = userEvent.setup()
    render(<TaskAuditHistorySection taskId="t1" />)
    await user.click(screen.getByRole('button', { name: /Auditoría/i }))
    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(/no autorizado/i)
  })
})
