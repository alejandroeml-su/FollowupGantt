import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

/**
 * Wave P6 · Equipo A5 — Tests de `useVersionCheck`.
 */

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      throw new Error('global supabase no debe usarse en tests; inyectar mock')
    },
    removeChannel: () => undefined,
  },
}))

import { useVersionCheck } from '@/lib/realtime-locks/use-version-check'

type PgListener = {
  filter: { event: string; table: string; filter?: string }
  cb: (payload: { new?: Record<string, unknown> }) => void
}

function createMockClient() {
  let listener: PgListener | null = null
  const channels: string[] = []

  const channel = {
    on(
      type: string,
      filter: { event: string; schema: string; table: string; filter?: string },
      cb: (payload: { new?: Record<string, unknown> }) => void,
    ) {
      if (type === 'postgres_changes') {
        listener = { filter, cb }
      }
      return channel
    },
    subscribe(cb?: (status: string) => void) {
      cb?.('SUBSCRIBED')
      return channel
    },
    presenceState: () => ({}),
    track: vi.fn().mockResolvedValue('ok'),
    send: vi.fn().mockResolvedValue('ok'),
  }
  const client = {
    channel: vi.fn((name: string) => {
      channels.push(name)
      return channel
    }),
    removeChannel: vi.fn(),
  }
  return {
    client,
    emit(payload: { new?: Record<string, unknown> }) {
      listener?.cb(payload)
    },
    get listener() {
      return listener
    },
    get channels() {
      return channels
    },
  }
}

describe('useVersionCheck', () => {
  it('arranca sin conflicto y sin remoteVersion', () => {
    const { client } = createMockClient()
    const { result } = renderHook(() =>
      useVersionCheck('task', 't-1', '2026-01-01T00:00:00.000Z', {}, client),
    )
    expect(result.current.hasConflict).toBe(false)
    expect(result.current.remoteVersion).toBeNull()
  })

  it('crea canal con nombre <entity>:<id>:version y filtro id=eq.<id>', () => {
    const harness = createMockClient()
    renderHook(() =>
      useVersionCheck('task', 't-99', '2026-01-01T00:00:00.000Z', {}, harness.client),
    )
    expect(harness.channels).toContain('task:t-99:version')
    expect(harness.listener?.filter).toMatchObject({
      event: 'UPDATE',
      table: 'tasks',
      filter: 'id=eq.t-99',
    })
  })

  it('mapea entityType=whiteboard a tabla whiteboards', () => {
    const harness = createMockClient()
    renderHook(() =>
      useVersionCheck('whiteboard', 'wb-1', null, {}, harness.client),
    )
    expect(harness.listener?.filter.table).toBe('whiteboards')
  })

  it('detecta conflicto cuando llega UPDATE con updatedAt más reciente', () => {
    const harness = createMockClient()
    const { result } = renderHook(() =>
      useVersionCheck(
        'task',
        't-1',
        '2026-01-01T00:00:00.000Z',
        { currentUserId: 'me' },
        harness.client,
      ),
    )
    act(() => {
      harness.emit({
        new: {
          id: 't-1',
          updatedAt: '2026-02-01T00:00:00.000Z',
          updatedById: 'someone-else',
        },
      })
    })
    expect(result.current.hasConflict).toBe(true)
    expect(result.current.remoteVersion).toBe('2026-02-01T00:00:00.000Z')
    expect(result.current.remoteAuthorId).toBe('someone-else')
  })

  it('NO marca conflicto si el UPDATE es del propio currentUserId', () => {
    const harness = createMockClient()
    const onSelfUpdate = vi.fn()
    const { result } = renderHook(() =>
      useVersionCheck(
        'task',
        't-1',
        '2026-01-01T00:00:00.000Z',
        { currentUserId: 'me', onSelfUpdate },
        harness.client,
      ),
    )
    act(() => {
      harness.emit({
        new: {
          id: 't-1',
          updatedAt: '2026-02-01T00:00:00.000Z',
          updatedById: 'me',
        },
      })
    })
    expect(result.current.hasConflict).toBe(false)
    expect(onSelfUpdate).toHaveBeenCalledWith('2026-02-01T00:00:00.000Z')
  })

  it('NO marca conflicto si el updatedAt remoto es más viejo o igual al local', () => {
    const harness = createMockClient()
    const { result } = renderHook(() =>
      useVersionCheck(
        'task',
        't-1',
        '2026-05-01T00:00:00.000Z',
        {},
        harness.client,
      ),
    )
    act(() => {
      harness.emit({
        new: {
          id: 't-1',
          updatedAt: '2026-04-01T00:00:00.000Z',
          updatedById: 'someone-else',
        },
      })
    })
    expect(result.current.hasConflict).toBe(false)
  })

  it('soporta snake_case (updated_at, updated_by_id) en payload Postgres', () => {
    const harness = createMockClient()
    const { result } = renderHook(() =>
      useVersionCheck(
        'task',
        't-1',
        '2026-01-01T00:00:00.000Z',
        { currentUserId: 'me' },
        harness.client,
      ),
    )
    act(() => {
      harness.emit({
        new: {
          id: 't-1',
          updated_at: '2026-02-01T00:00:00.000Z',
          updated_by_id: 'pedro',
        },
      })
    })
    expect(result.current.hasConflict).toBe(true)
    expect(result.current.remoteAuthorId).toBe('pedro')
  })

  it('acknowledge() limpia hasConflict', () => {
    const harness = createMockClient()
    const { result } = renderHook(() =>
      useVersionCheck(
        'task',
        't-1',
        '2026-01-01T00:00:00.000Z',
        { currentUserId: 'me' },
        harness.client,
      ),
    )
    act(() => {
      harness.emit({
        new: {
          id: 't-1',
          updatedAt: '2026-02-01T00:00:00.000Z',
          updatedById: 'someone',
        },
      })
    })
    expect(result.current.hasConflict).toBe(true)
    act(() => {
      result.current.acknowledge()
    })
    expect(result.current.hasConflict).toBe(false)
  })

  it('si entityId es null no se suscribe', () => {
    const harness = createMockClient()
    renderHook(() =>
      useVersionCheck('task', null, '2026-01-01', {}, harness.client),
    )
    expect(harness.client.channel).not.toHaveBeenCalled()
  })

  it('invoca onRemoteUpdate al detectar UPDATE remoto', () => {
    const harness = createMockClient()
    const onRemoteUpdate = vi.fn()
    renderHook(() =>
      useVersionCheck(
        'task',
        't-1',
        '2026-01-01T00:00:00.000Z',
        { currentUserId: 'me', onRemoteUpdate },
        harness.client,
      ),
    )
    act(() => {
      harness.emit({
        new: {
          id: 't-1',
          updatedAt: '2026-02-01T00:00:00.000Z',
          updatedById: 'pedro',
        },
      })
    })
    expect(onRemoteUpdate).toHaveBeenCalledWith(
      '2026-02-01T00:00:00.000Z',
      'pedro',
    )
  })

  it('cleanup: removeChannel se llama al unmount', () => {
    const harness = createMockClient()
    const { unmount } = renderHook(() =>
      useVersionCheck('task', 't-1', '2026-01-01', {}, harness.client),
    )
    unmount()
    expect(harness.client.removeChannel).toHaveBeenCalledTimes(1)
  })
})
