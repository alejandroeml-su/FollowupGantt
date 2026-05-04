import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TypingIndicator } from '@/components/comments/TypingIndicator'

describe('TypingIndicator', () => {
  it('no renderiza nada si la lista está vacía', () => {
    const { container } = render(<TypingIndicator users={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('1 usuario → "X está escribiendo…"', () => {
    render(<TypingIndicator users={[{ id: 'u2', name: 'Ana' }]} />)
    const el = screen.getByTestId('typing-indicator')
    expect(el).toHaveTextContent(/Ana está escribiendo…/)
  })

  it('2 usuarios → "X y Y escribiendo…"', () => {
    render(
      <TypingIndicator
        users={[
          { id: 'u2', name: 'Ana' },
          { id: 'u3', name: 'Pedro' },
        ]}
      />,
    )
    const el = screen.getByTestId('typing-indicator')
    expect(el).toHaveTextContent(/Ana y Pedro escribiendo…/)
  })

  it('>2 usuarios → "X, Y y N más escribiendo…"', () => {
    render(
      <TypingIndicator
        users={[
          { id: 'u2', name: 'Ana' },
          { id: 'u3', name: 'Pedro' },
          { id: 'u4', name: 'Luis' },
          { id: 'u5', name: 'María' },
        ]}
      />,
    )
    const el = screen.getByTestId('typing-indicator')
    expect(el).toHaveTextContent(/Ana, Pedro y 2 más escribiendo…/)
  })

  it('expone aria-live="polite" y role="status" para accesibilidad', () => {
    render(<TypingIndicator users={[{ id: 'u2', name: 'Ana' }]} />)
    const el = screen.getByTestId('typing-indicator')
    expect(el).toHaveAttribute('aria-live', 'polite')
    expect(el).toHaveAttribute('role', 'status')
  })

  it('cae a "Alguien" cuando un usuario llega sin nombre', () => {
    render(<TypingIndicator users={[{ id: 'u2', name: '' }]} />)
    const el = screen.getByTestId('typing-indicator')
    expect(el).toHaveTextContent(/Alguien está escribiendo…/)
  })
})
