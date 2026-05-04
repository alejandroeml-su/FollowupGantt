import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  WhiteboardToolbar,
  toolToElementType,
  type ToolId,
} from '@/components/whiteboards/WhiteboardToolbar'

describe('<WhiteboardToolbar />', () => {
  const renderToolbar = (overrides: Partial<React.ComponentProps<typeof WhiteboardToolbar>> = {}) => {
    const defaultProps: React.ComponentProps<typeof WhiteboardToolbar> = {
      activeTool: null,
      onSelectTool: vi.fn(),
      snapEnabled: true,
      onToggleSnap: vi.fn(),
      onExportPng: vi.fn(),
      ...overrides,
    }
    return { props: defaultProps, ...render(<WhiteboardToolbar {...defaultProps} />) }
  }

  it('expone las herramientas en español', () => {
    renderToolbar()
    expect(screen.getByRole('button', { name: /Añadir Sticky/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Añadir Conector/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Añadir Texto/i })).toBeInTheDocument()
  })

  it('selecciona "Seleccionar" cuando activeTool es null', () => {
    renderToolbar({ activeTool: null })
    expect(screen.getByRole('button', { name: 'Seleccionar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('marca pressed=true en el tool activo', () => {
    renderToolbar({ activeTool: { kind: 'STICKY' } })
    expect(screen.getByRole('button', { name: /Añadir Sticky/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('emite onSelectTool al hacer click en un tool', () => {
    const onSelect = vi.fn()
    renderToolbar({ onSelectTool: onSelect })
    fireEvent.click(screen.getByRole('button', { name: /Añadir Conector/i }))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'CONNECTOR' })
  })

  it('toggle de snap dispara onToggleSnap', () => {
    const onToggle = vi.fn()
    renderToolbar({ snapEnabled: true, onToggleSnap: onToggle })
    const snap = screen.getByRole('checkbox', { name: /snap a grid/i })
    fireEvent.click(snap)
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('botón Exportar PNG llama onExportPng', () => {
    const onExport = vi.fn()
    renderToolbar({ onExportPng: onExport })
    fireEvent.click(screen.getByRole('button', { name: /Exportar PNG/i }))
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('toolToElementType mapea SHAPE → SHAPE', () => {
    const t: ToolId = { kind: 'SHAPE', variant: 'circle' }
    expect(toolToElementType(t)).toBe('SHAPE')
  })

  it('toolToElementType mapea STICKY/TEXT/CONNECTOR/IMAGE', () => {
    expect(toolToElementType({ kind: 'STICKY' })).toBe('STICKY')
    expect(toolToElementType({ kind: 'TEXT' })).toBe('TEXT')
    expect(toolToElementType({ kind: 'CONNECTOR' })).toBe('CONNECTOR')
    expect(toolToElementType({ kind: 'IMAGE' })).toBe('IMAGE')
  })
})
