import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WhiteboardCanvas } from '@/components/whiteboards/WhiteboardCanvas'
import type { WhiteboardElement } from '@/lib/whiteboards/types'

const sampleSticky: WhiteboardElement = {
  id: 'el-sticky',
  whiteboardId: 'wb-1',
  type: 'STICKY',
  x: 50,
  y: 60,
  width: 160,
  height: 160,
  rotation: 0,
  zIndex: 1,
  data: { kind: 'sticky', color: '#FEF08A', text: 'Hola' },
}

const sampleShape: WhiteboardElement = {
  id: 'el-shape',
  whiteboardId: 'wb-1',
  type: 'SHAPE',
  x: 300,
  y: 60,
  width: 120,
  height: 120,
  rotation: 0,
  zIndex: 2,
  data: { kind: 'shape', variant: 'circle', fill: '#1e293b', stroke: '#94a3b8' },
}

describe('<WhiteboardCanvas />', () => {
  const renderCanvas = (overrides: Partial<React.ComponentProps<typeof WhiteboardCanvas>> = {}) => {
    const defaultProps: React.ComponentProps<typeof WhiteboardCanvas> = {
      elements: [sampleSticky, sampleShape],
      selectedId: null,
      onSelect: vi.fn(),
      onMove: vi.fn(),
      snapEnabled: true,
      ...overrides,
    }
    return { props: defaultProps, ...render(<WhiteboardCanvas {...defaultProps} />) }
  }

  it('renderiza un sticky con su contenido', () => {
    renderCanvas()
    expect(screen.getByTestId('sticky-el-sticky')).toHaveTextContent('Hola')
  })

  it('renderiza una forma circular', () => {
    renderCanvas()
    expect(screen.getByTestId('shape-el-shape')).toBeInTheDocument()
  })

  it('hace mousedown sobre un elemento dispara onSelect', () => {
    const onSelect = vi.fn()
    renderCanvas({ onSelect })
    const el = screen.getByTestId('sticky-el-sticky')
    fireEvent.mouseDown(el, { clientX: 60, clientY: 70 })
    expect(onSelect).toHaveBeenCalledWith('el-sticky')
  })

  it('click en lienzo vacío sin onCanvasClick deselecciona', () => {
    const onSelect = vi.fn()
    renderCanvas({ selectedId: 'el-sticky', onSelect })
    const canvas = screen.getByTestId('whiteboard-canvas')
    fireEvent.mouseDown(canvas, { clientX: 700, clientY: 500 })
    fireEvent.mouseUp(canvas, { clientX: 700, clientY: 500 })
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('click en lienzo vacío con onCanvasClick emite coordenadas mundo', () => {
    const onCanvasClick = vi.fn()
    renderCanvas({ onCanvasClick })
    const canvas = screen.getByTestId('whiteboard-canvas')
    fireEvent.mouseDown(canvas, { clientX: 700, clientY: 500 })
    fireEvent.mouseUp(canvas, { clientX: 700, clientY: 500 })
    expect(onCanvasClick).toHaveBeenCalledTimes(1)
    expect(onCanvasClick.mock.calls[0][0]).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
  })

  it('elemento seleccionado lleva la clase outline', () => {
    renderCanvas({ selectedId: 'el-sticky' })
    const el = screen.getByTestId('sticky-el-sticky')
    expect(el.className).toMatch(/outline/)
  })

  it('zoom indicator muestra 100% por defecto', () => {
    renderCanvas()
    expect(screen.getByText('100%', { selector: 'span' })).toBeInTheDocument()
  })
})
