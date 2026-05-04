import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * Wave P6 · Equipo A4 — Tests para
 * `src/lib/realtime-notifications/use-notifications-realtime.ts`.
 *
 * Estrategia:
 *   - Mock de las server actions (`getNotificationsForCurrentUser`,
 *     `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`).
 *   - Cliente Supabase fake inyectado vía `opts.supabaseClient` con un
 *     emisor manual `triggerPayload(payload)` para simular eventos
 *     `postgres_changes`.
 *   - jsdom expone `window`, así que el hook entra en la rama Realtime.
 */

const getNotificationsMock = vi.fn()
const getUnreadCountMock = vi.fn()
const markReadMock = vi.fn()
const markAllReadMock = vi.fn()

vi.mock('@/lib/actions/notifications', () => ({
  getNotificationsForCurrentUser: (...a: unknown[]) => getNotificationsMock(...a),
  getUnreadCount: (...a: unknown[]) => getUnreadCountMock(...a),
  markNotificationRead: (...a: unknown[]) => markReadMock(...a),
  markAllNotificationsRead: (...a: unknown[]) => markAllReadMock(...a),
}))

import {
  useNotificationsRealtime,
  type RealtimePayload,
  type SupabaseClientLike,
} from '@/lib/realtime-notifications/use-notifications-realtime'

type Listener = (payload: RealtimePayload) => void

function createFakeSupabase() {
  const listeners: Listener[] = []
  let subscribeCallback: ((status: string) => void) | null = null
  const channel = {
    on(_event: string, _filter: unknown, cb: Listener) {
      listeners.push(cb)
      return channel
    },
    subscribe(cb?: (status: string) => void) {
      subscribeCallback = cb ?? null
      // Imitamos el callback async de Supabase (microtask).
      Promise.resolve().then(() => subscribeCallback?.('SUBSCRIBED'))
      return channel
    },
    unsubscribe: vi.fn(async () => 'ok' as const),
  }
  const client: SupabaseClientLike = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok' as const),
  }
  return {
    client,
    channel,
    triggerPayload(payload: RealtimePayload) {
      listeners.forEach((l) => l(payload))
    },
    triggerStatus(status: string) {
      subscribeCallback?.(status)
    },
  }
}

const ITEM_NEW = {
  id: 'n1',
  userId: 'u1',
  type: 'MENTION',
  title: 'Te mencionaron',
  body: 'hola',
  link: null,
  data: null,
  readAt: null,
  createdAt: new Date('2026-05-04T10:00:00Z').toISOString(),
}

const ITEM_OLD = {
  id: 'n0',
  userId: 'u1',
  type: 'TASK_ASSIGNED',
  title: 'Asignación',
  body: null,
  link: null,
  data: null,
  readAt: null,
  createdAt: new Date('2026-05-03T10:00:00Z').toISOString(),
}

beforeEach(() => {
  getNotificationsMock.mockReset()
  getUnreadCountMock.mockReset()
  markReadMock.mockReset()
  markAllReadMock.mockReset()
  getNotificationsMock.mockResolvedValue([])
  getUnreadCountMock.mockResolvedValue(0)
  markReadMock.mockResolvedValue({ id: 'n1', readAt: new Date().toISOString() })
  markAllReadMock.mockResolvedValue({ count: 0 })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useNotificationsRealtime', () => {
  it('hace fetch inicial al montar con userId válido', async () => {
    getNotificationsMock.mockResolvedValue([ITEM_OLD])
    getUnreadCountMock.mockResolvedValue(1)
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1)
      expect(result.current.unreadCount).toBe(1)
    })
    expect(getNotificationsMock).toHaveBeenCalledWith({ limit: 20, userId: 'u1' })
    expect(getUnreadCountMock).toHaveBeenCalledWith('u1')
  })

  it('no fetch ni canal cuando userId es null', async () => {
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime(null, { supabaseClient: fake.client }),
    )
    await waitFor(() => {
      expect(result.current.notifications).toEqual([])
      expect(result.current.unreadCount).toBe(0)
    })
    expect(getNotificationsMock).not.toHaveBeenCalled()
    expect(fake.client.channel).not.toHaveBeenCalled()
  })

  it('marca isConnected=true tras SUBSCRIBED', async () => {
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })
  })

  it('agrega notificación al recibir INSERT y aumenta unreadCount', async () => {
    getNotificationsMock.mockResolvedValue([])
    getUnreadCountMock.mockResolvedValue(0)
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => expect(result.current.isConnected).toBe(true))

    act(() => {
      fake.triggerPayload({
        eventType: 'INSERT',
        new: { ...ITEM_NEW },
        old: null,
      })
    })
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1)
      expect(result.current.notifications[0]?.id).toBe('n1')
      expect(result.current.unreadCount).toBe(1)
    })
  })

  it('dedupe INSERTs con mismo id', async () => {
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    act(() => {
      fake.triggerPayload({ eventType: 'INSERT', new: { ...ITEM_NEW }, old: null })
      fake.triggerPayload({ eventType: 'INSERT', new: { ...ITEM_NEW }, old: null })
    })
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1)
      expect(result.current.unreadCount).toBe(1)
    })
  })

  it('UPDATE con readAt no nulo decrementa unreadCount', async () => {
    getNotificationsMock.mockResolvedValue([ITEM_OLD])
    getUnreadCountMock.mockResolvedValue(1)
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => {
      expect(result.current.unreadCount).toBe(1)
    })
    act(() => {
      fake.triggerPayload({
        eventType: 'UPDATE',
        new: { ...ITEM_OLD, readAt: new Date('2026-05-04T11:00:00Z').toISOString() },
        old: { ...ITEM_OLD },
      })
    })
    await waitFor(() => {
      expect(result.current.unreadCount).toBe(0)
      expect(result.current.notifications[0]?.readAt).not.toBeNull()
    })
  })

  it('DELETE remueve la notificación y decrementa si era unread', async () => {
    getNotificationsMock.mockResolvedValue([ITEM_OLD])
    getUnreadCountMock.mockResolvedValue(1)
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => expect(result.current.unreadCount).toBe(1))
    act(() => {
      fake.triggerPayload({
        eventType: 'DELETE',
        new: null,
        old: { ...ITEM_OLD },
      })
    })
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(0)
      expect(result.current.unreadCount).toBe(0)
    })
  })

  it('markAsRead aplica optimistic update y llama server action', async () => {
    getNotificationsMock.mockResolvedValue([ITEM_OLD])
    getUnreadCountMock.mockResolvedValue(1)
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => expect(result.current.unreadCount).toBe(1))

    await act(async () => {
      await result.current.markAsRead('n0')
    })

    expect(markReadMock).toHaveBeenCalledWith('n0', 'u1')
    expect(result.current.unreadCount).toBe(0)
    expect(result.current.notifications[0]?.readAt).not.toBeNull()
  })

  it('markAllAsRead aplica optimistic update y deja unreadCount=0', async () => {
    getNotificationsMock.mockResolvedValue([ITEM_OLD, ITEM_NEW])
    getUnreadCountMock.mockResolvedValue(2)
    markAllReadMock.mockResolvedValue({ count: 2 })
    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => expect(result.current.unreadCount).toBe(2))

    await act(async () => {
      await result.current.markAllAsRead()
    })

    expect(markAllReadMock).toHaveBeenCalledWith('u1')
    expect(result.current.unreadCount).toBe(0)
    expect(result.current.notifications.every((n) => n.readAt !== null)).toBe(
      true,
    )
  })

  it('markAsRead revierte y refresca cuando el server falla', async () => {
    getNotificationsMock.mockResolvedValueOnce([ITEM_OLD])
    getUnreadCountMock.mockResolvedValueOnce(1)
    markReadMock.mockRejectedValueOnce(new Error('[NOT_FOUND]'))
    // Segundo refresh trae los datos sin cambios.
    getNotificationsMock.mockResolvedValue([ITEM_OLD])
    getUnreadCountMock.mockResolvedValue(1)

    const fake = createFakeSupabase()
    const { result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => expect(result.current.unreadCount).toBe(1))

    await act(async () => {
      await result.current.markAsRead('n0')
    })

    // Tras el fallo, refresca y vuelve al estado original (1 unread).
    await waitFor(() => {
      expect(result.current.unreadCount).toBe(1)
      expect(result.current.notifications[0]?.readAt).toBeNull()
    })
  })

  it('cleanup llama removeChannel al desmontar', async () => {
    const fake = createFakeSupabase()
    const { unmount, result } = renderHook(() =>
      useNotificationsRealtime('u1', { supabaseClient: fake.client }),
    )
    await waitFor(() => expect(result.current.isConnected).toBe(true))
    unmount()
    expect(fake.client.removeChannel).toHaveBeenCalled()
  })

  it('respeta enableRealtime=false (no abre canal)', async () => {
    const fake = createFakeSupabase()
    renderHook(() =>
      useNotificationsRealtime('u1', {
        supabaseClient: fake.client,
        enableRealtime: false,
      }),
    )
    await waitFor(() => {
      expect(getNotificationsMock).toHaveBeenCalled()
    })
    expect(fake.client.channel).not.toHaveBeenCalled()
  })
})
