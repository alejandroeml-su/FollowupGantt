import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Wave P6 · Equipo B1 — Tests del wiring `ProjectHeaderPresence`.
 *
 * Mockeamos el hook `usePresence` para evitar tocar Supabase y poder
 * controlar el estado de la lista de usuarios. Los tests cubren:
 *  - Render vacío (degradación graceful sin Realtime).
 *  - Render con N usuarios (avatares + indicador).
 *  - Subscripción al canal correcto (`project:{id}`).
 *  - Identidad propagada al hook (drilling de `currentUser`).
 *  - Truncado a `max=5` con badge `+N` para overflow.
 *  - Pluralización del aria-label (1 vs varios).
 */

import type { PresenceState, PresenceUser } from '@/lib/realtime/types'

const mockUsePresence = vi.fn<
  (channel: string | null, identity: unknown) => PresenceState
>()

vi.mock('@/lib/realtime/use-presence', () => ({
  usePresence: (channel: string | null, identity: unknown) =>
    mockUsePresence(channel, identity),
}))

import ProjectHeaderPresence from '@/components/projects/ProjectHeaderPresence'

function makeUser(
  userId: string,
  name: string,
  overrides: Partial<PresenceUser> = {},
): PresenceUser {
  return {
    userId,
    name,
    status: 'online',
    lastSeen: new Date('2026-05-04T10:00:00Z').toISOString(),
    ...overrides,
  }
}

const EDWIN = {
  userId: 'edwin-1',
  name: 'Edwin Martinez',
}

beforeEach(() => {
  mockUsePresence.mockReset()
})

describe('ProjectHeaderPresence', () => {
  it('no renderiza nada cuando la lista de presence está vacía (graceful)', () => {
    mockUsePresence.mockReturnValue({ users: [], me: null, isOnline: false })

    const { container } = render(
      <ProjectHeaderPresence currentUser={EDWIN} projectId="p-123" />,
    )

    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('project-header-presence')).toBeNull()
  })

  it('renderiza avatars + indicador con el conteo cuando hay usuarios', () => {
    mockUsePresence.mockReturnValue({
      users: [
        makeUser('edwin-1', 'Edwin Martinez'),
        makeUser('ana-2', 'Ana Lopez'),
      ],
      me: makeUser('edwin-1', 'Edwin Martinez'),
      isOnline: true,
    })

    render(<ProjectHeaderPresence currentUser={EDWIN} projectId="p-123" />)

    expect(screen.getByTestId('project-header-presence')).toBeInTheDocument()
    // Avatars (PresenceAvatars usa role="group")
    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-label',
      '2 personas viendo',
    )
    // Indicator
    expect(screen.getByRole('status')).toHaveTextContent('2 personas viendo')
  })

  it('suscribe al canal `project:{id}` con la identidad provista', () => {
    mockUsePresence.mockReturnValue({ users: [], me: null, isOnline: false })

    render(<ProjectHeaderPresence currentUser={EDWIN} projectId="proj-xyz" />)

    expect(mockUsePresence).toHaveBeenCalledWith('project:proj-xyz', {
      userId: 'edwin-1',
      name: 'Edwin Martinez',
      avatarUrl: undefined,
    })
  })

  it('propaga `avatarUrl` al hook cuando el currentUser lo trae', () => {
    mockUsePresence.mockReturnValue({ users: [], me: null, isOnline: false })

    render(
      <ProjectHeaderPresence
        currentUser={{
          userId: 'u1',
          name: 'Test',
          avatarUrl: 'https://cdn.example.com/u1.png',
        }}
        projectId="p-1"
      />,
    )

    expect(mockUsePresence).toHaveBeenCalledWith('project:p-1', {
      userId: 'u1',
      name: 'Test',
      avatarUrl: 'https://cdn.example.com/u1.png',
    })
  })

  it('trunca avatares visibles a 5 y muestra badge `+N` para el overflow', () => {
    const users = Array.from({ length: 8 }, (_, i) =>
      makeUser(`u${i}`, `User ${i}`),
    )
    mockUsePresence.mockReturnValue({
      users,
      me: users[0]!,
      isOnline: true,
    })

    render(<ProjectHeaderPresence currentUser={EDWIN} projectId="p-1" />)

    // Badge "+3" cuando hay 8 y se muestran 5.
    expect(screen.getByLabelText('3 personas más')).toBeInTheDocument()
    // Indicador refleja el total real (8), no los visibles.
    expect(screen.getByRole('status')).toHaveTextContent('8 personas viendo')
  })

  it('singulariza correctamente cuando hay solo 1 persona', () => {
    mockUsePresence.mockReturnValue({
      users: [makeUser('solo-1', 'Solo User')],
      me: makeUser('solo-1', 'Solo User'),
      isOnline: true,
    })

    render(<ProjectHeaderPresence currentUser={EDWIN} projectId="p-1" />)

    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-label',
      '1 persona viendo',
    )
    expect(screen.getByRole('status')).toHaveTextContent('1 persona viendo')
  })
})
