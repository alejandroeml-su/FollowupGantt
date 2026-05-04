/**
 * Wave P6 · A1 · Tests de `usePresence` + componentes `PresenceAvatars`
 * y `PresenceIndicator`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, render, screen } from '@testing-library/react'
import React from 'react'

// ── Fake SDK (idéntico al de use-channel.test) ───────────────────────────

interface FakeChannel {
  subscribe: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  track: ReturnType<typeof vi.fn>
  untrack: ReturnType<typeof vi.fn>
  presenceState: ReturnType<typeof vi.fn>
  __subscribeCb?: (status: string, err?: Error) => void
  __presenceCbs: Map<string, () => void>
  __presenceMap: Record<string, Array<Record<string, unknown>>>
}

interface FakeClient {
  channel: ReturnType<typeof vi.fn>
  removeChannel: ReturnType<typeof vi.fn>
  __channels: FakeChannel[]
}

let fakeClient: FakeClient | null = null

function makeFakeChannel(): FakeChannel {
  const ch: FakeChannel = {
    __presenceCbs: new Map(),
    __presenceMap: {},
    subscribe: vi.fn().mockImplementation((cb) => {
      ch.__subscribeCb = cb
      return ch
    }),
    on: vi.fn().mockImplementation((type: string, filter: { event: string }, cb: () => void) => {
      if (type === 'presence') ch.__presenceCbs.set(filter.event, cb)
      return ch
    }),
    send: vi.fn().mockResolvedValue('ok'),
    track: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      const key = String(payload.userId ?? 'self')
      ch.__presenceMap[key] = [payload]
      ch.__presenceCbs.get('sync')?.()
      return 'ok'
    }),
    untrack: vi.fn().mockImplementation(async () => {
      ch.__presenceMap = {}
      ch.__presenceCbs.get('sync')?.()
      return 'ok'
    }),
    presenceState: vi.fn().mockImplementation(() => ch.__presenceMap),
  }
  return ch
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => {
    const client: FakeClient = {
      __channels: [],
      channel: vi.fn().mockImplementation(() => {
        const ch = makeFakeChannel()
        client.__channels.push(ch)
        return ch
      }),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    }
    fakeClient = client
    return client
  }),
}))

import { __resetBrowserClientForTests } from '@/lib/realtime/supabase-client'
import { usePresence } from '@/lib/realtime/use-presence'
import PresenceAvatars from '@/components/realtime/PresenceAvatars'
import PresenceIndicator from '@/components/realtime/PresenceIndicator'
import type { PresenceUser } from '@/lib/realtime/types'

beforeEach(() => {
  __resetBrowserClientForTests()
  fakeClient = null
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const ME = {
  userId: 'u-1',
  name: 'Edwin Martínez',
  avatarUrl: undefined,
}

// ── Tests · usePresence ──────────────────────────────────────────────────

describe('usePresence', () => {
  it('arranca vacío y offline', () => {
    const { result } = renderHook(() => usePresence('project:abc', ME))
    expect(result.current.users).toEqual([])
    expect(result.current.isOnline).toBe(false)
  })

  it('hace track con identity al recibir SUBSCRIBED', async () => {
    const { result } = renderHook(() => usePresence('project:abc', ME))
    const ch = fakeClient!.__channels[0]
    await act(async () => {
      await ch.__subscribeCb?.('SUBSCRIBED')
    })
    expect(ch.track).toHaveBeenCalled()
    const arg = ch.track.mock.calls[0][0]
    expect(arg.userId).toBe('u-1')
    expect(arg.name).toBe('Edwin Martínez')
    expect(arg.lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(result.current.isOnline).toBe(true)
    expect(result.current.users).toHaveLength(1)
    expect(result.current.users[0].userId).toBe('u-1')
  })

  it('actualiza users cuando entra otro usuario (presence:sync)', async () => {
    const { result } = renderHook(() => usePresence('project:abc', ME))
    const ch = fakeClient!.__channels[0]
    await act(async () => {
      await ch.__subscribeCb?.('SUBSCRIBED')
    })
    await act(async () => {
      ch.__presenceMap['u-2'] = [
        {
          userId: 'u-2',
          name: 'Otro',
          status: 'online',
          lastSeen: new Date().toISOString(),
        },
      ]
      ch.__presenceCbs.get('sync')?.()
    })
    expect(result.current.users.map((u) => u.userId).sort()).toEqual(['u-1', 'u-2'])
  })

  it('llama untrack en unmount', async () => {
    const { unmount } = renderHook(() => usePresence('project:abc', ME))
    const ch = fakeClient!.__channels[0]
    await act(async () => {
      await ch.__subscribeCb?.('SUBSCRIBED')
    })
    unmount()
    expect(ch.untrack).toHaveBeenCalled()
  })

  it('degrada a no-op cuando faltan env vars', () => {
    vi.unstubAllEnvs()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    __resetBrowserClientForTests()

    const { result } = renderHook(() => usePresence('project:abc', ME))
    expect(result.current.users).toEqual([])
    expect(result.current.isOnline).toBe(false)
    expect(fakeClient).toBeNull()
  })

  it('no se suscribe si identity es null', () => {
    renderHook(() => usePresence('project:abc', null))
    if (fakeClient) {
      expect(fakeClient.channel).not.toHaveBeenCalled()
    }
  })
})

// ── Tests · PresenceAvatars ──────────────────────────────────────────────

const u = (id: string, name: string, status: PresenceUser['status'] = 'online'): PresenceUser => ({
  userId: id,
  name,
  status,
  lastSeen: '2026-05-04T10:00:00Z',
})

describe('PresenceAvatars', () => {
  it('no renderiza nada cuando users=[]', () => {
    const { container } = render(React.createElement(PresenceAvatars, { users: [] }))
    expect(container.firstChild).toBeNull()
  })

  it('renderiza un avatar con iniciales cuando hay 1 usuario', () => {
    render(React.createElement(PresenceAvatars, { users: [u('a', 'Ana López')] }))
    expect(screen.getByText('AL')).toBeInTheDocument()
    // aria-label en singular
    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-label',
      '1 persona viendo'
    )
  })

  it('renderiza 3 avatares sin badge +N', () => {
    const users = [u('a', 'Ana'), u('b', 'Beto'), u('c', 'Cira')]
    render(React.createElement(PresenceAvatars, { users }))
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(screen.queryByText(/^\+/)).toBeNull()
  })

  it('limita a max=5 y muestra +N para el resto', () => {
    const users = Array.from({ length: 6 }, (_, i) =>
      u(`u${i}`, `Persona ${i}`)
    )
    render(React.createElement(PresenceAvatars, { users, max: 5 }))
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-label',
      '6 personas viendo'
    )
  })

  it('expone tooltip con nombre y estado en title', () => {
    render(React.createElement(PresenceAvatars, { users: [u('a', 'Ana', 'busy')] }))
    const el = screen.getByLabelText('Ana, Ocupado')
    expect(el).toHaveAttribute('title', 'Ana · Ocupado')
  })
})

// ── Tests · PresenceIndicator ────────────────────────────────────────────

describe('PresenceIndicator', () => {
  it('no renderiza con count=0 y sin text', () => {
    const { container } = render(React.createElement(PresenceIndicator, { count: 0 }))
    expect(container.firstChild).toBeNull()
  })

  it('compone "1 persona <label>" en singular', () => {
    render(
      React.createElement(PresenceIndicator, {
        count: 1,
        label: 'viendo este proyecto',
      })
    )
    expect(screen.getByText('1 persona viendo este proyecto')).toBeInTheDocument()
  })

  it('compone "3 personas <label>" en plural', () => {
    render(
      React.createElement(PresenceIndicator, {
        count: 3,
        label: 'viendo este proyecto',
      })
    )
    expect(screen.getByText('3 personas viendo este proyecto')).toBeInTheDocument()
  })
})
