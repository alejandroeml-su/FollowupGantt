import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster, toast } from '@/components/interactions/Toaster'

beforeEach(() => {
  toast.__resetForTests()
})

describe('Toaster', () => {
  it('no renderiza nada cuando no hay toasts', () => {
    render(<Toaster />)
    const region = screen.getByRole('region', { name: /notificaciones/i })
    expect(region.children.length).toBe(0)
  })

  it('muestra un toast de error con role=alert', () => {
    render(<Toaster />)
    act(() => toast.error('WIP excedido'))
    expect(screen.getByRole('alert')).toHaveTextContent(/WIP excedido/)
  })

  it('muestra un toast de éxito con role=status', () => {
    render(<Toaster />)
    act(() => toast.success('Guardado'))
    expect(screen.getByRole('status')).toHaveTextContent(/Guardado/)
  })

  it('auto-dismiss tras 5s', async () => {
    vi.useFakeTimers()
    render(<Toaster />)
    act(() => toast.info('Hola'))
    expect(screen.getByRole('status')).toBeVisible()
    act(() => {
      vi.advanceTimersByTime(5100)
    })
    expect(screen.queryByRole('status')).toBeNull()
    vi.useRealTimers()
  })

  it('botón Cerrar descarta el toast', async () => {
    render(<Toaster />)
    act(() => toast.info('Test manual dismiss'))
    const closeBtn = screen.getByRole('button', { name: /cerrar/i })
    await userEvent.click(closeBtn)
    expect(screen.queryByText('Test manual dismiss')).toBeNull()
  })
})
