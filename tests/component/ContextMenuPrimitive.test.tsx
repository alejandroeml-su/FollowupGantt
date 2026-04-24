import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  TaskContextMenu,
  type MenuItem,
} from '@/components/interactions/ContextMenuPrimitive'

/**
 * Radix ContextMenu se abre con evento contextmenu (click derecho).
 * userEvent.pointer soporta button: 'secondary'.
 */
async function rightClick(el: Element) {
  await userEvent.pointer([
    { target: el as HTMLElement, keys: '[MouseRight>]' },
    { keys: '[/MouseRight]' },
  ])
}

describe('TaskContextMenu', () => {
  it('abre con click derecho y muestra items', async () => {
    const onEdit = vi.fn()
    const items: MenuItem[] = [
      { label: 'Editar', shortcut: 'E', onSelect: onEdit },
      { type: 'separator' },
      { label: 'Eliminar', destructive: true, shortcut: '⌘⌫' },
    ]

    render(
      <TaskContextMenu
        trigger={<button type="button">target</button>}
        items={items}
      />,
    )

    await rightClick(screen.getByText('target'))
    expect(await screen.findByText('Editar')).toBeInTheDocument()
    expect(screen.getByText('Eliminar')).toBeInTheDocument()
    expect(screen.getByText('E')).toBeInTheDocument()
  })

  it('dispara onSelect al elegir un item', async () => {
    const onEdit = vi.fn()
    render(
      <TaskContextMenu
        trigger={<button type="button">trg</button>}
        items={[{ label: 'Editar', onSelect: onEdit }]}
      />,
    )

    await rightClick(screen.getByText('trg'))
    await userEvent.click(await screen.findByText('Editar'))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('renderiza separador y label como primitivos ARIA', async () => {
    render(
      <TaskContextMenu
        trigger={<button type="button">t</button>}
        items={[
          { type: 'label', label: 'ACCIONES' },
          { label: 'Uno' },
          { type: 'separator' },
          { label: 'Dos' },
        ]}
      />,
    )
    await rightClick(screen.getByText('t'))
    expect(await screen.findByText('ACCIONES')).toBeInTheDocument()
    // Radix añade role="separator"
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('submenú se expande al hover/flecha derecha', async () => {
    render(
      <TaskContextMenu
        trigger={<button type="button">trg</button>}
        items={[
          {
            label: 'Mover a',
            submenu: [{ label: 'Lista A' }, { label: 'Lista B' }],
          },
        ]}
      />,
    )

    await rightClick(screen.getByText('trg'))
    const trigger = await screen.findByText('Mover a')
    await userEvent.hover(trigger)
    // Espera a que aparezca el submenú
    expect(await screen.findByText('Lista A')).toBeInTheDocument()
  })

  it('items disabled no disparan onSelect', async () => {
    const fn = vi.fn()
    render(
      <TaskContextMenu
        trigger={<button type="button">trg</button>}
        items={[{ label: 'Deshabilitado', disabled: true, onSelect: fn }]}
      />,
    )
    await rightClick(screen.getByText('trg'))
    const item = await screen.findByText('Deshabilitado')
    await userEvent.click(item)
    expect(fn).not.toHaveBeenCalled()
  })
})
