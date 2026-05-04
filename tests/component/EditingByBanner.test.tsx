import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { EditingByBanner } from '@/components/realtime-locks/EditingByBanner'
import type { EditingUser } from '@/lib/realtime-locks/types'

const ana: EditingUser = { id: 'u-ana', name: 'Ana Pérez' }
const pedro: EditingUser = { id: 'u-pedro', name: 'Pedro Gómez' }
const luis: EditingUser = { id: 'u-luis', name: 'Luis Silva' }
const maria: EditingUser = { id: 'u-maria', name: 'María Díaz' }

describe('EditingByBanner', () => {
  it('no renderiza nada cuando editingUsers está vacío', () => {
    const { container } = render(
      <EditingByBanner editingUsers={[]} isLockedByOther={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('muestra el nombre cuando hay un solo usuario editando', () => {
    render(
      <EditingByBanner editingUsers={[ana]} isLockedByOther={true} />,
    )
    expect(screen.getByTestId('editing-by-banner')).toHaveTextContent(
      /Ana Pérez/,
    )
    expect(screen.getByTestId('editing-by-banner')).toHaveTextContent(
      /está editando este registro/,
    )
  })

  it('formatea "Ana y Pedro" cuando hay dos editores', () => {
    render(
      <EditingByBanner
        editingUsers={[ana, pedro]}
        isLockedByOther={true}
      />,
    )
    expect(screen.getByTestId('editing-by-banner')).toHaveTextContent(
      /Ana Pérez y Pedro Gómez/,
    )
    expect(screen.getByTestId('editing-by-banner')).toHaveTextContent(
      /están editando este registro/,
    )
  })

  it('formatea "A, B y C" cuando hay tres editores', () => {
    render(
      <EditingByBanner
        editingUsers={[ana, pedro, luis]}
        isLockedByOther={false}
      />,
    )
    expect(screen.getByTestId('editing-by-banner')).toHaveTextContent(
      /Ana Pérez, Pedro Gómez y Luis Silva/,
    )
  })

  it('colapsa avatares más allá de maxAvatars y muestra "+N"', () => {
    render(
      <EditingByBanner
        editingUsers={[ana, pedro, luis, maria]}
        isLockedByOther={true}
        maxAvatars={2}
      />,
    )
    const overflow = screen.getByTestId('editing-by-banner-overflow')
    expect(overflow).toHaveTextContent('+2')
  })

  it('muestra mensaje "modo solo lectura" cuando isLockedByOther=true', () => {
    render(
      <EditingByBanner editingUsers={[ana]} isLockedByOther={true} />,
    )
    expect(screen.getByTestId('editing-by-banner')).toHaveTextContent(
      /modo solo lectura/i,
    )
  })

  it('NO muestra "modo solo lectura" cuando isLockedByOther=false', () => {
    render(
      <EditingByBanner editingUsers={[ana]} isLockedByOther={false} />,
    )
    expect(screen.getByTestId('editing-by-banner')).not.toHaveTextContent(
      /modo solo lectura/i,
    )
  })

  it('muestra botón "Forzar edición" sólo cuando isLockedByOther y onForceOverride se proveen', async () => {
    const onForce = vi.fn()
    render(
      <EditingByBanner
        editingUsers={[ana]}
        isLockedByOther={true}
        onForceOverride={onForce}
      />,
    )
    const btn = screen.getByTestId('editing-by-banner-force')
    await userEvent.click(btn)
    expect(onForce).toHaveBeenCalledTimes(1)
  })

  it('NO muestra "Forzar edición" si isLockedByOther es false', () => {
    render(
      <EditingByBanner
        editingUsers={[ana]}
        isLockedByOther={false}
        onForceOverride={() => {}}
      />,
    )
    expect(
      screen.queryByTestId('editing-by-banner-force'),
    ).not.toBeInTheDocument()
  })

  it('botón Cerrar invoca onDismiss', async () => {
    const onDismiss = vi.fn()
    render(
      <EditingByBanner
        editingUsers={[ana]}
        isLockedByOther={false}
        onDismiss={onDismiss}
      />,
    )
    const btn = screen.getByTestId('editing-by-banner-dismiss')
    await userEvent.click(btn)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('expone role=status y aria-live=polite (a11y)', () => {
    render(
      <EditingByBanner editingUsers={[ana]} isLockedByOther={true} />,
    )
    const banner = screen.getByTestId('editing-by-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })
})
