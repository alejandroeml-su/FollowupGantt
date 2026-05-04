/**
 * Wave P6 · A1 · Tests de `useChannel` y `useBroadcast`.
 *
 * Mockeamos `@supabase/supabase-js` con un fake `createClient` que devuelve
 * un cliente cuyo `channel()` retorna un objeto instrumentado. Los tests
 * disparan callbacks de subscribe/broadcast manualmente para validar que
 * el hook actualiza estado y limpia recursos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ── Fake Supabase SDK ────────────────────────────────────────────────────

type SubscribeCb = (status: string, err?: Error) => void
type BroadcastCb = (msg: { payload: unknown }) => void

interface FakeChannel {
  subscribe: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  track: ReturnType<typeof vi.fn>
  untrack: ReturnType<typeof vi.fn>
  presenceState: ReturnType<typeof vi.fn>
  __subscribeCb?: SubscribeCb
  __broadcastCbs: Map<string, BroadcastCb>
  __presenceCbs: Map<string, (...args: unknown[]) => void>
}

interface FakeClient {
  channel: ReturnType<typeof vi.fn>
  removeChannel: ReturnType<typeof vi.fn>
  __channels: FakeChannel[]
}

let fakeClient: FakeClient | null = null

function makeFakeChannel(): FakeChannel {
  const ch: FakeChannel = {
    __broadcastCbs: new Map(),
    __presenceCbs: new Map(),
    subscribe: vi.fn().mockImplementation((cb?: SubscribeCb) => {
      ch.__subscribeCb = cb
      return ch
    }),
    on: vi.fn().mockImplementation((type: string, filter: { event: string }, cb: (...args: unknown[]) => void) => {
      if (type === 'broadcast') ch.__broadcastCbs.set(filter.event, cb as BroadcastCb)
      else if (type === 'presence') ch.__presenceCbs.set(filter.event, cb)
      return ch
    }),
    send: vi.fn().mockResolvedValue('ok'),
    track: vi.fn().mockResolvedValue('ok'),
    untrack: vi.fn().mockResolvedValue('ok'),
    presenceState: vi.fn().mockReturnValue({}),
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

// ── Imports bajo test ────────────────────────────────────────────────────

import { __resetBrowserClientForTests } from '@/lib/realtime/supabase-client'
import { useChannel } from '@/lib/realtime/use-channel'
import { useBroadcast } from '@/lib/realtime/use-broadcast'

// ── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  __resetBrowserClientForTests()
  fakeClient = null
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fake.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Tests · useChannel ───────────────────────────────────────────────────

describe('useChannel', () => {
  it('inicia con isReady=false y sin error', () => {
    const { result } = renderHook(() => useChannel('project:abc'))
    expect(result.current.isReady).toBe(false)
    expect(result.current.isConnected).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('marca isReady=true cuando el SDK reporta SUBSCRIBED', async () => {
    const { result } = renderHook(() => useChannel('project:abc'))
    const ch = fakeClient!.__channels[0]
    expect(ch).toBeDefined()
    await act(async () => {
      ch.__subscribeCb?.('SUBSCRIBED')
    })
    expect(result.current.isReady).toBe(true)
    expect(result.current.isConnected).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('captura error en CHANNEL_ERROR', async () => {
    const { result } = renderHook(() => useChannel('project:abc'))
    const ch = fakeClient!.__channels[0]
    const fail = new Error('boom')
    await act(async () => {
      ch.__subscribeCb?.('CHANNEL_ERROR', fail)
    })
    expect(result.current.isReady).toBe(false)
    expect(result.current.error).toBe(fail)
  })

  it('llama removeChannel en unmount', async () => {
    const { unmount } = renderHook(() => useChannel('project:abc'))
    const ch = fakeClient!.__channels[0]
    unmount()
    expect(fakeClient!.removeChannel).toHaveBeenCalledWith(ch)
  })

  it('no crea channel cuando channelName es null', () => {
    renderHook(() => useChannel(null))
    // El fake client puede no haberse creado todavía si nadie llamó al SDK,
    // pero si se creó, su channel() no debe haber sido invocado.
    if (fakeClient) {
      expect(fakeClient.channel).not.toHaveBeenCalled()
    }
  })

  it('no-op cuando faltan env vars (Realtime deshabilitado)', () => {
    vi.unstubAllEnvs()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    __resetBrowserClientForTests()

    const { result } = renderHook(() => useChannel('project:abc'))
    expect(result.current.isReady).toBe(false)
    expect(result.current.error).toBeNull()
    // No se debe haber instanciado cliente real
    expect(fakeClient).toBeNull()
  })

  it('re-suscribe cuando cambia channelName', async () => {
    const { rerender } = renderHook(
      ({ name }: { name: string }) => useChannel(name),
      { initialProps: { name: 'project:a' } }
    )
    const first = fakeClient!.__channels[0]
    rerender({ name: 'project:b' })
    expect(fakeClient!.removeChannel).toHaveBeenCalledWith(first)
    expect(fakeClient!.__channels.length).toBeGreaterThanOrEqual(2)
  })
})

// ── Tests · useBroadcast ─────────────────────────────────────────────────

describe('useBroadcast', () => {
  it('registra handler on(broadcast,event)', () => {
    renderHook(() => useBroadcast<{ x: number }>('project:abc', 'cursor:move'))
    const ch = fakeClient!.__channels[0]
    expect(ch.on).toHaveBeenCalledWith(
      'broadcast',
      { event: 'cursor:move' },
      expect.any(Function)
    )
  })

  it('acumula mensajes recibidos en messages', async () => {
    const { result } = renderHook(() =>
      useBroadcast<{ x: number }>('project:abc', 'cursor:move')
    )
    const ch = fakeClient!.__channels[0]
    const cb = ch.__broadcastCbs.get('cursor:move')!
    await act(async () => {
      cb({ payload: { x: 1 } })
      cb({ payload: { x: 2 } })
    })
    expect(result.current.messages).toEqual([{ x: 1 }, { x: 2 }])
  })

  it('limita el buffer a BROADCAST_BUFFER_SIZE (50)', async () => {
    const { result } = renderHook(() =>
      useBroadcast<{ i: number }>('project:abc', 'tick')
    )
    const ch = fakeClient!.__channels[0]
    const cb = ch.__broadcastCbs.get('tick')!
    await act(async () => {
      for (let i = 0; i < 60; i++) cb({ payload: { i } })
    })
    expect(result.current.messages).toHaveLength(50)
    expect(result.current.messages[0]).toEqual({ i: 10 })
    expect(result.current.messages[49]).toEqual({ i: 59 })
  })

  it('send() llama channel.send con type=broadcast tras SUBSCRIBED', async () => {
    const { result } = renderHook(() =>
      useBroadcast<{ x: number }>('project:abc', 'cursor:move')
    )
    const ch = fakeClient!.__channels[0]
    await act(async () => {
      ch.__subscribeCb?.('SUBSCRIBED')
    })
    await act(async () => {
      await result.current.send({ x: 42 })
    })
    expect(ch.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'cursor:move',
      payload: { x: 42 },
    })
  })

  it('send() es no-op si el channel aún no está SUBSCRIBED', async () => {
    const { result } = renderHook(() =>
      useBroadcast<{ x: number }>('project:abc', 'cursor:move')
    )
    const ch = fakeClient!.__channels[0]
    await act(async () => {
      await result.current.send({ x: 1 })
    })
    expect(ch.send).not.toHaveBeenCalled()
  })
})
