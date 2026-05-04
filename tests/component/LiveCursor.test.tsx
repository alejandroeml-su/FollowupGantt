import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveCursor } from '@/components/realtime-cursors/LiveCursor'

describe('LiveCursor', () => {
  it('renderiza el SVG cursor y la etiqueta con nombre', () => {
    render(<LiveCursor x={10} y={20} name="Edwin" color="#ef4444" />)
    const cursor = screen.getByTestId('live-cursor')
    expect(cursor).toBeInTheDocument()
    expect(cursor.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('live-cursor-label')).toHaveTextContent('Edwin')
  })

  it('aplica position absolute y transform translate3d con las coords', () => {
    render(<LiveCursor x={123} y={456} name="A" color="#22c55e" />)
    const node = screen.getByTestId('live-cursor')
    expect(node.style.position).toBe('absolute')
    expect(node.style.transform).toContain('translate3d(123px, 456px, 0)')
  })

  it('usa el color recibido como fill del SVG y fondo de la etiqueta', () => {
    render(<LiveCursor x={0} y={0} name="B" color="#a855f7" />)
    const path = screen.getByTestId('live-cursor').querySelector('path')!
    expect(path.getAttribute('fill')?.toLowerCase()).toBe('#a855f7')
    const label = screen.getByTestId('live-cursor-label')
    // jsdom normaliza color a rgb; comprobamos por backgroundColor crudo del style.
    expect(label.style.backgroundColor.toLowerCase()).toMatch(/^(#a855f7|rgb\(168, 85, 247\))$/)
  })

  it('aria-hidden y pointer-events:none — no interfiere con interacción', () => {
    render(<LiveCursor x={0} y={0} name="C" color="#06b6d4" />)
    const node = screen.getByTestId('live-cursor')
    expect(node.getAttribute('aria-hidden')).toBe('true')
    expect(node.style.pointerEvents).toBe('none')
  })

  it('expone data-user-id cuando se pasa userId', () => {
    render(
      <LiveCursor x={0} y={0} name="D" color="#ec4899" userId="user-42" />,
    )
    expect(screen.getByTestId('live-cursor').getAttribute('data-user-id')).toBe('user-42')
  })

  it('aplica transición CSS corta al transform para suavizar el movimiento', () => {
    render(<LiveCursor x={5} y={5} name="E" color="#eab308" />)
    const node = screen.getByTestId('live-cursor')
    expect(node.style.transition).toContain('transform')
    expect(node.style.transition).toContain('0.05s')
    expect(node.style.transition).toContain('linear')
  })

  it('trunca el nombre con ellipsis y lo pone en title (a11y / overflow)', () => {
    const longName = 'Nombre de Usuario Muy Largo Que Debe Cortar Bonito'
    render(<LiveCursor x={0} y={0} name={longName} color="#f97316" />)
    const label = screen.getByTestId('live-cursor-label')
    expect(label.style.textOverflow).toBe('ellipsis')
    expect(label.style.whiteSpace).toBe('nowrap')
    expect(label.getAttribute('title')).toBe(longName)
  })
})
