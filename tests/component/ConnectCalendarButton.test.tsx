import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Wave P8 · Equipo P8-5 — Tests de ConnectCalendarButton.
 */

import { ConnectCalendarButton } from '@/components/calendar-sync/ConnectCalendarButton'

describe('ConnectCalendarButton', () => {
  it('1. renderiza estado "Conectar" cuando connected=false', () => {
    render(<ConnectCalendarButton provider="google" connected={false} />)
    const btn = screen.getByTestId('connect-calendar-google')
    expect(btn).toHaveTextContent('Conectar Google Calendar')
    expect(btn).toHaveAttribute('data-state', 'disconnected')
  })

  it('2. renderiza estado "Reconectar" cuando connected=true', () => {
    render(<ConnectCalendarButton provider="google" connected={true} />)
    const btn = screen.getByTestId('connect-calendar-google')
    expect(btn).toHaveTextContent('Reconectar Google Calendar')
    expect(btn).toHaveAttribute('data-state', 'connected')
  })

  it('3. muestra mensaje de status cuando connected=true', () => {
    render(<ConnectCalendarButton provider="microsoft" connected={true} />)
    const status = screen.getByTestId('connect-calendar-microsoft-status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent(/Conectado/)
  })

  it('4. NO muestra status cuando connected=false', () => {
    render(<ConnectCalendarButton provider="microsoft" connected={false} />)
    expect(
      screen.queryByTestId('connect-calendar-microsoft-status'),
    ).toBeNull()
  })

  it('5. provider microsoft muestra label correcto', () => {
    render(<ConnectCalendarButton provider="microsoft" connected={false} />)
    expect(screen.getByTestId('connect-calendar-microsoft')).toHaveTextContent(
      'Conectar Microsoft Outlook',
    )
  })

  it('6. invoca onConnect callback con el provider al hacer click', async () => {
    const onConnect = vi.fn()
    render(
      <ConnectCalendarButton
        provider="google"
        connected={false}
        onConnect={onConnect}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('connect-calendar-google'))
    expect(onConnect).toHaveBeenCalledWith('google')
  })

  it('7. botón es tipo button (no submit)', () => {
    render(<ConnectCalendarButton provider="google" connected={false} />)
    expect(screen.getByTestId('connect-calendar-google')).toHaveAttribute(
      'type',
      'button',
    )
  })

  it('8. aplica className custom', () => {
    render(
      <ConnectCalendarButton
        provider="google"
        connected={false}
        className="my-custom-class"
      />,
    )
    const wrapper = screen
      .getByTestId('connect-calendar-google')
      .closest('div')
    expect(wrapper?.className).toContain('my-custom-class')
  })
})
