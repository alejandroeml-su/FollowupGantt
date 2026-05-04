import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Tests para `TimerWidget`. Mockeamos las server actions y el toast
 * imperativo. Verificamos:
 *   1. Estado idle muestra "Iniciar timer" y arranca al click.
 *   2. Estado running muestra contador formateado y botón "Detener".
 *   3. "Detener" llama stopTimer y vuelve al estado idle.
 *   4. Si initialActive pertenece a OTRA tarea, deshabilita el botón.
 *   5. "Cancelar" llama cancelActiveTimer y vuelve al idle.
 */

const startTimerMock = vi.fn()
const stopTimerMock = vi.fn()
const cancelTimerMock = vi.fn()

vi.mock('@/lib/actions/time-entries', () => ({
  startTimer: (...args: unknown[]) => startTimerMock(...args),
  stopTimer: (...args: unknown[]) => stopTimerMock(...args),
  cancelActiveTimer: (...args: unknown[]) => cancelTimerMock(...args),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
const toastInfo = vi.fn()
vi.mock('@/components/interactions/Toaster', () => ({
  toast: {
    error: (m: string) => toastError(m),
    success: (m: string) => toastSuccess(m),
    info: (m: string) => toastInfo(m),
  },
}))

import { TimerWidget } from '@/components/time-tracking/TimerWidget'

beforeEach(() => {
  startTimerMock.mockReset()
  stopTimerMock.mockReset()
  cancelTimerMock.mockReset()
  toastError.mockReset()
  toastSuccess.mockReset()
  toastInfo.mockReset()
})

describe('TimerWidget', () => {
  it('muestra "Iniciar timer" en idle y dispara startTimer al click', async () => {
    startTimerMock.mockResolvedValue({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMinutes: 0,
      description: null,
      hourlyRate: null,
      cost: null,
      createdAt: new Date().toISOString(),
    })

    render(<TimerWidget taskId="t-1" userId="u-1" initialActive={null} />)
    expect(screen.getByText(/Iniciar timer/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Iniciar timer/i }))
    expect(startTimerMock).toHaveBeenCalledWith({ userId: 'u-1', taskId: 't-1' })
  })

  it('muestra el contador y "Detener" cuando hay timer activo de esta tarea', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString() // 90 s atrás
    render(
      <TimerWidget
        taskId="t-1"
        userId="u-1"
        initialActive={{
          id: 'te-1',
          userId: 'u-1',
          taskId: 't-1',
          startedAt,
          endedAt: null,
          durationMinutes: 0,
          description: null,
          hourlyRate: null,
          cost: null,
          createdAt: startedAt,
        }}
      />,
    )
    expect(screen.getByTestId('timer-widget-running')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Detener/i })).toBeInTheDocument()
  })

  it('"Detener" llama stopTimer y al resolver vuelve al estado idle', async () => {
    stopTimerMock.mockResolvedValue({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMinutes: 1,
      description: null,
      hourlyRate: null,
      cost: null,
      createdAt: new Date().toISOString(),
    })

    const startedAt = new Date(Date.now() - 60_000).toISOString()
    render(
      <TimerWidget
        taskId="t-1"
        userId="u-1"
        initialActive={{
          id: 'te-1',
          userId: 'u-1',
          taskId: 't-1',
          startedAt,
          endedAt: null,
          durationMinutes: 0,
          description: null,
          hourlyRate: null,
          cost: null,
          createdAt: startedAt,
        }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Detener/i }))
    expect(stopTimerMock).toHaveBeenCalledWith({ entryId: 'te-1' })

    // Tras la transición, debe volver al idle.
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId('timer-widget-running')).toBeNull()
  })

  it('si initialActive es de otra tarea, deshabilita "Iniciar timer"', () => {
    render(
      <TimerWidget
        taskId="t-1"
        userId="u-1"
        initialActive={{
          id: 'te-other',
          userId: 'u-1',
          taskId: 'OTHER-task',
          startedAt: new Date().toISOString(),
          endedAt: null,
          durationMinutes: 0,
          description: null,
          hourlyRate: null,
          cost: null,
          createdAt: new Date().toISOString(),
        }}
      />,
    )
    const btn = screen.getByRole('button', { name: /Iniciar timer/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/Timer activo en otra tarea/)).toBeInTheDocument()
  })

  it('"Cancelar" llama cancelActiveTimer y vuelve al idle', async () => {
    cancelTimerMock.mockResolvedValue({ ok: true })
    const startedAt = new Date(Date.now() - 30_000).toISOString()
    render(
      <TimerWidget
        taskId="t-1"
        userId="u-1"
        initialActive={{
          id: 'te-1',
          userId: 'u-1',
          taskId: 't-1',
          startedAt,
          endedAt: null,
          durationMinutes: 0,
          description: null,
          hourlyRate: null,
          cost: null,
          createdAt: startedAt,
        }}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Cancelar/i }))
    expect(cancelTimerMock).toHaveBeenCalledWith({ userId: 'u-1' })
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId('timer-widget-running')).toBeNull()
  })
})
