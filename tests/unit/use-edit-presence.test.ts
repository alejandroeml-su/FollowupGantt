import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

/**
 * Wave P6 · Equipo A5 — Tests de `useEditPresence`.
 *
 * Estrategia: inyectamos un `RealtimeClientLike` mock que captura las
 * llamadas a `channel`, `track`, `subscribe`, `on`, `removeChannel` y nos
 * deja simular eventos presence/broadcast invocando los callbacks
 * registrados.
 */

// Stub `@/lib/supabase` para que la import del hook no instancie el cliente
// real (que requiere NEXT_PUBLIC_SUPABASE_URL en runtime).
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      throw new Error('global supabase no debe usarse en tests; inyectar mock')
    },
    removeChannel: () => undefined,
  },
}))

import { useEditPresence } from '@/lib/realtime-locks/use-edit-presence'
import type { EditingUser } from '@/lib/realtime-locks/types'

type Listener = {
  type: 'presence' | 'broadcast' | 'postgres_changes'
  event: string
  cb: (...args: unknown[]) => void
}

function createMockClient() {
  const tracked: Array<Record<string, unknown>> = []
  const sentBroadcasts: Array<{ event: string; payload: unknown }> = []
  let presenceState: Record<string, Record<string, unknown>[]> = {}
  let listeners: Listener[] = []
  let subscribeCb: ((status: string) => void) | null = null

  const channel = {
    on(type: string, filter: { event: string }, cb: (...args: unknown[]) => void) {
      listeners.push({
        type: type as Listener['type'],
        event: filter.event,
        cb,
      })
      return channel
    },
    track(meta: Record<string, unknown>) {
      tracked.push(meta)
      // Auto-actualiza el presence state para que `presenceState()` lo refleje.
      const user = meta.user as { id: string } | undefined
      if (user?.id) {
        presenceState[user.id] = [meta]
      }
      return Promise.resolve('ok')
    },
    untrack() {
      return Promise.resolve('ok')
    },
    presenceState<T>() {
      return presenceState as Record<string, T[]>
    },
    send(msg: { event: string; payload: unknown; type?: string }) {
      sentBroadcasts.push({ event: msg.event, payload: msg.payload })
      return Promise.resolve('ok')
    },
    subscribe(cb?: (status: string) => void) {
      subscribeCb = cb ?? null
      // Default: simular subscribe inmediato.
      cb?.('SUBSCRIBED')
      return channel
    },
  }

  const client = {
    channel: vi.fn((_name: string) => channel),
    removeChannel: vi.fn((_c: unknown) => 'ok'),
  }

  return {
    client,
    helpers: {
      get tracked() {
        return tracked
      },
      get sentBroadcasts() {
        return sentBroadcasts
      },
      setPresenceState(next: Record<string, Record<string, unknown>[]>) {
        presenceState = next
      },
      triggerSync() {
        listeners
          .filter((l) => l.type === 'presence' && l.event === 'sync')
          .forEach((l) => l.cb())
      },
      triggerJoin(payload: unknown) {
        listeners
          .filter((l) => l.type === 'presence' && l.event === 'join')
          .forEach((l) => l.cb(payload))
      },
      triggerLeave(payload: unknown) {
        listeners
          .filter((l) => l.type === 'presence' && l.event === 'leave')
          .forEach((l) => l.cb(payload))
      },
      triggerBroadcast(event: string, payload: unknown) {
        listeners
          .filter((l) => l.type === 'broadcast' && l.event === event)
          .forEach((l) => l.cb({ event, payload }))
      },
      triggerStatus(status: string) {
        subscribeCb?.(status)
      },
      reset() {
        tracked.length = 0
        sentBroadcasts.length = 0
        presenceState = {}
        listeners = []
        subscribeCb = null
      },
    },
  }
}

const ana: EditingUser = { id: 'u-ana', name: 'Ana', color: '#ff8800' }
const pedro: EditingUser = { id: 'u-pedro', name: 'Pedro' }
const luis: EditingUser = { id: 'u-luis', name: 'Luis' }

describe('useEditPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('arranca con editingUsers=[] y isLockedByOther=false', () => {
    const { client } = createMockClient()
    const { result } = renderHook(() =>
      useEditPresence('task:1:edit', ana, {}, client),
    )
    expect(result.current.editingUsers).toEqual([])
    expect(result.current.isLockedByOther).toBe(false)
    expect(result.current.isCurrentUserEditing).toBe(false)
  })

  it('crea el canal con el nombre exacto y se anuncia con isEditing=false al subscribir', () => {
    const { client, helpers } = createMockClient()
    renderHook(() => useEditPresence('task:42:edit', ana, {}, client))
    expect(client.channel).toHaveBeenCalledWith(
      'task:42:edit',
      expect.objectContaining({
        config: expect.objectContaining({
          presence: expect.objectContaining({ key: 'u-ana' }),
        }),
      }),
    )
    // Tras SUBSCRIBED, debe haber un track con isEditing=false.
    expect(helpers.tracked.length).toBeGreaterThan(0)
    expect(helpers.tracked[0]).toMatchObject({ isEditing: false })
  })

  it('startEditing prende isCurrentUserEditing y trackea isEditing=true', () => {
    const { client, helpers } = createMockClient()
    const { result } = renderHook(() =>
      useEditPresence('task:1:edit', ana, {}, client),
    )
    act(() => {
      result.current.startEditing()
    })
    expect(result.current.isCurrentUserEditing).toBe(true)
    const lastTrack = helpers.tracked[helpers.tracked.length - 1]
    expect(lastTrack).toMatchObject({ isEditing: true })
  })

  it('stopEditing baja el flag y emite broadcast lock:released', () => {
    const { client, helpers } = createMockClient()
    const { result } = renderHook(() =>
      useEditPresence('task:1:edit', ana, {}, client),
    )
    act(() => {
      result.current.startEditing()
    })
    act(() => {
      result.current.stopEditing()
    })
    expect(result.current.isCurrentUserEditing).toBe(false)
    expect(helpers.sentBroadcasts.some((b) => b.event === 'lock:released')).toBe(
      true,
    )
  })

  it('heartbeat: re-trackea cada heartbeatIntervalMs mientras edita', () => {
    const { client, helpers } = createMockClient()
    const { result } = renderHook(() =>
      useEditPresence('task:1:edit', ana, { heartbeatIntervalMs: 1000 }, client),
    )
    act(() => {
      result.current.startEditing()
    })
    const baseline = helpers.tracked.length
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    // 3 heartbeats adicionales en 3.5s con intervalo 1s.
    expect(helpers.tracked.length - baseline).toBeGreaterThanOrEqual(3)
  })

  it('detecta lock ajeno cuando llega un peer con isEditing=true vía sync', () => {
    const { client, helpers } = createMockClient()
    const { result } = renderHook(() =>
      useEditPresence('task:1:edit', ana, {}, client),
    )
    helpers.setPresenceState({
      [pedro.id]: [
        {
          user: pedro,
          isEditing: true,
          since: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        },
      ],
    })
    act(() => {
      helpers.triggerSync()
    })
    expect(result.current.editingUsers.map((u) => u.id)).toEqual([pedro.id])
    expect(result.current.isLockedByOther).toBe(true)
  })

  it('excluye al currentUser de editingUsers aunque esté en presence', () => {
    const { client, helpers } = createMockClient()
    const { result } = renderHook(() =>
      useEditPresence('task:1:edit', ana, {}, client),
    )
    helpers.setPresenceState({
      [ana.id]: [
        {
          user: ana,
          isEditing: true,
          since: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        },
      ],
      [pedro.id]: [
        {
          user: pedro,
          isEditing: true,
          since: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        },
      ],
    })
    act(() => {
      helpers.triggerSync()
    })
    expect(result.current.editingUsers.map((u) => u.id)).toEqual([pedro.id])
  })

  it('filtra peers stale (heartbeat más viejo que staleAfterMs)', () => {
    const { client, helpers } = createMockClient()
    const { result } = renderHook(() =>
      useEditPresence('task:1:edit', ana, { staleAfterMs: 5000 }, client),
    )
    const longAgo = new Date(Date.now() - 60_000).toISOString()
    helpers.setPresenceState({
      [pedro.id]: [
        { user: pedro, isEditing: true, since: longAgo, heartbeatAt: longAgo },
      ],
      [luis.id]: [
        {
          user: luis,
          isEditing: true,
          since: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        },
      ],
    })
    act(() => {
      helpers.triggerSync()
    })
    expect(result.current.editingUsers.map((u) => u.id)).toEqual([luis.id])
  })

  it('forceOverride emite broadcast lock:override_requested y enciende lock local', () => {
    const { client, helpers } = createMockClient()
    const { result } = renderHook(() =>
      useEditPresence('task:1:edit', ana, {}, client),
    )
    helpers.setPresenceState({
      [pedro.id]: [
        {
          user: pedro,
          isEditing: true,
          since: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        },
      ],
    })
    act(() => {
      helpers.triggerSync()
    })
    expect(result.current.isLockedByOther).toBe(true)
    act(() => {
      result.current.forceOverride()
    })
    expect(result.current.isCurrentUserEditing).toBe(true)
    expect(
      helpers.sentBroadcasts.some((b) => b.event === 'lock:override_requested'),
    ).toBe(true)
  })

  it('invoca onOverrideRequested cuando llega broadcast desde otro peer', () => {
    const { client, helpers } = createMockClient()
    const onOverrideRequested = vi.fn()
    renderHook(() =>
      useEditPresence(
        'task:1:edit',
        ana,
        { onOverrideRequested },
        client,
      ),
    )
    act(() => {
      helpers.triggerBroadcast('lock:override_requested', {
        from: pedro,
        at: new Date().toISOString(),
      })
    })
    expect(onOverrideRequested).toHaveBeenCalledWith(pedro)
  })

  it('ignora broadcast lock:override_requested si viene del propio usuario', () => {
    const { client, helpers } = createMockClient()
    const onOverrideRequested = vi.fn()
    renderHook(() =>
      useEditPresence('task:1:edit', ana, { onOverrideRequested }, client),
    )
    act(() => {
      helpers.triggerBroadcast('lock:override_requested', {
        from: ana,
        at: new Date().toISOString(),
      })
    })
    expect(onOverrideRequested).not.toHaveBeenCalled()
  })

  it('isRealtimeAvailable=false cuando subscribe responde CHANNEL_ERROR', () => {
    // Reescribimos el cliente para que subscribe NO emita SUBSCRIBED auto.
    const { client, helpers } = createMockClient()
    const { result, rerender } = renderHook(() =>
      useEditPresence('task:1:edit', ana, {}, client),
    )
    // Tras subscribe automático debe estar disponible.
    rerender()
    expect(result.current.isRealtimeAvailable).toBe(true)
    // Simulamos un error posterior.
    act(() => {
      helpers.triggerStatus('CHANNEL_ERROR')
    })
    expect(result.current.isRealtimeAvailable).toBe(false)
  })

  it('cleanup: removeChannel se llama al unmount', () => {
    const { client } = createMockClient()
    const { unmount } = renderHook(() =>
      useEditPresence('task:1:edit', ana, {}, client),
    )
    unmount()
    expect(client.removeChannel).toHaveBeenCalledTimes(1)
  })
})
