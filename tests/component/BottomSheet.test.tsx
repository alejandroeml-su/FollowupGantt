import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BottomSheet } from '@/components/mobile/BottomSheet'

describe('BottomSheet', () => {
  it('no renderiza nada cuando open=false', () => {
    const onClose = vi.fn()
    const { container } = render(
      <BottomSheet open={false} onClose={onClose} title="Test">
        <p>contenido</p>
      </BottomSheet>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renderiza dialog accesible con título cuando open=true', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Detalle de tarea">
        <p>contenido del sheet</p>
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog', { name: /detalle de tarea/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('contenido del sheet')).toBeInTheDocument()
  })

  it('llama onClose al hacer click en el botón Cerrar', async () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Filtros">
        <p>x</p>
      </BottomSheet>,
    )
    // Hay 2 botones con aria-label "Cerrar" (backdrop + header).
    const closeButtons = screen.getAllByRole('button', { name: /cerrar/i })
    await userEvent.click(closeButtons[closeButtons.length - 1])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('llama onClose al hacer click en el backdrop', async () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Filtros">
        <p>x</p>
      </BottomSheet>,
    )
    const closeButtons = screen.getAllByRole('button', { name: /cerrar/i })
    // El primero es el backdrop (renderizado antes del header).
    await userEvent.click(closeButtons[0])
    expect(onClose).toHaveBeenCalled()
  })

  it('cierra al presionar Escape', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Más opciones">
        <p>x</p>
      </BottomSheet>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('aplica safe-area-inset-bottom al contenedor del sheet', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Test">
        <p>x</p>
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-safe-area', 'bottom')
    expect(dialog.className).toMatch(/safe-area-inset-bottom/)
  })
})
