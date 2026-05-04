'use client'

/**
 * Wave P6 · Equipo A4 — Hook de notificaciones en tiempo real.
 *
 * Combina:
 *   - Fetch inicial vía `getNotificationsForCurrentUser` (server action).
 *   - Suscripción a Supabase Realtime (`postgres_changes` sobre la tabla
 *     `Notification` filtrada por `userId`).
 *   - Mutaciones optimistas para `markAsRead` / `markAllAsRead` con
 *     reconciliación al fallar.
 *
 * Compatible con SSR: el hook detecta entornos sin `window` y no abre
 * canales (devuelve estado inicial). En tests, el cliente Supabase puede
 * inyectarse vía `opts.supabaseClient` para evitar abrir sockets.
 *
 * Notas:
 *   - El filtro `userId=eq.X` requiere que la tabla `Notification` tenga
 *     habilitada la replicación lógica para Realtime (publicación
 *     `supabase_realtime`). Si no está activa, el canal nunca emite y el
 *     hook funciona como fetch inicial + sin updates en vivo.
 *   - Al recibir un `INSERT`, hacemos prepend a la lista local sin volver
 *     al server (ya tenemos el row); en `UPDATE` (markRead remoto) lo
 *     reemplazamos en el array.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getNotificationsForCurrentUser,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type SerializedNotification,
} from '@/lib/actions/notifications'

/**
 * Shape mínimo que necesitamos del cliente Supabase. Tipado laxo para que
 * tests puedan inyectar un mock sin importar `@supabase/supabase-js`.
 */
export interface RealtimeChannelLike {
  on(
    event: 'postgres_changes',
    filter: { event: string; schema: string; table: string; filter?: string },
    callback: (payload: RealtimePayload) => void,
  ): RealtimeChannelLike
  subscribe(callback?: (status: string) => void): RealtimeChannelLike
  unsubscribe(): Promise<'ok' | 'error' | 'timed out'>
}

export interface SupabaseClientLike {
  channel(name: string): RealtimeChannelLike
  removeChannel(channel: RealtimeChannelLike): Promise<'ok' | 'error' | 'timed out'>
}

export type RealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown> | null
  old: Record<string, unknown> | null
}

export type UseNotificationsRealtimeOptions = {
  /** Si false, no abre canal Realtime — útil en tests. */
  enableRealtime?: boolean
  /** Cliente Supabase inyectable (si no se pasa, importa el global). */
  supabaseClient?: SupabaseClientLike
  /** Tamaño inicial de la lista. */
  limit?: number
}

export type UseNotificationsRealtimeResult = {
  notifications: SerializedNotification[]
  unreadCount: number
  loading: boolean
  /** True si el canal Realtime está conectado (`SUBSCRIBED`). */
  isConnected: boolean
  refresh: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
}

/**
 * Convierte un row `Notification` (snake_case desde Postgres) a
 * `SerializedNotification` (camelCase). Postgres devuelve el shape literal
 * de la columna; nuestro modelo Prisma tiene columnas camelCase con quotes
 * en SQL, por lo que las keys ya vienen en camelCase. Defendemos contra
 * shapes inesperados con coerciones seguras.
 */
function rowToNotification(
  row: Record<string, unknown> | null,
): SerializedNotification | null {
  if (!row || typeof row !== 'object') return null
  const id = typeof row.id === 'string' ? row.id : null
  const userId = typeof row.userId === 'string' ? row.userId : null
  const type = typeof row.type === 'string' ? row.type : null
  const title = typeof row.title === 'string' ? row.title : null
  if (!id || !userId || !type || !title) return null

  const readAtRaw = row.readAt
  const createdAtRaw = row.createdAt

  const toIso = (v: unknown): string | null => {
    if (v == null) return null
    if (v instanceof Date) return v.toISOString()
    if (typeof v === 'string') return v
    return null
  }

  return {
    id,
    userId,
    type: type as SerializedNotification['type'],
    title,
    body: typeof row.body === 'string' ? row.body : null,
    link: typeof row.link === 'string' ? row.link : null,
    data: (row.data as SerializedNotification['data']) ?? null,
    readAt: toIso(readAtRaw),
    createdAt: toIso(createdAtRaw) ?? new Date().toISOString(),
  }
}

/**
 * Importa lazy el cliente Supabase global. Se hace dinámico para que
 * los tests puedan inyectar `supabaseClient` sin cargar la lib real.
 */
async function loadDefaultSupabase(): Promise<SupabaseClientLike | null> {
  try {
    const mod = (await import('@/lib/supabase')) as {
      supabase: SupabaseClientLike
    }
    return mod.supabase ?? null
  } catch {
    return null
  }
}

export function useNotificationsRealtime(
  userId: string | null | undefined,
  opts: UseNotificationsRealtimeOptions = {},
): UseNotificationsRealtimeResult {
  const { enableRealtime = true, supabaseClient, limit = 20 } = opts

  const [notifications, setNotifications] = useState<SerializedNotification[]>([])
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [isConnected, setIsConnected] = useState<boolean>(false)

  // Ref a la lista actual para usarla en callbacks Realtime sin re-suscribir.
  // El sync se hace en `useEffect` (no durante render) para cumplir con la
  // regla `react-hooks/refs` de React 19.
  const notificationsRef = useRef<SerializedNotification[]>([])
  useEffect(() => {
    notificationsRef.current = notifications
  }, [notifications])

  const refresh = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [list, count] = await Promise.all([
        getNotificationsForCurrentUser({ limit, userId }),
        getUnreadCount(userId),
      ])
      setNotifications(list)
      setUnreadCount(count)
    } catch (err) {
      console.error('[useNotificationsRealtime] refresh', err)
    } finally {
      setLoading(false)
    }
  }, [userId, limit])

  // Carga inicial al cambiar userId.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!userId) {
      setNotifications([])
      setUnreadCount(0)
      return
    }
    refresh()
  }, [userId, refresh])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Suscripción Realtime.
  useEffect(() => {
    if (!enableRealtime || !userId) return
    if (typeof window === 'undefined') return

    let cancelled = false
    let channel: RealtimeChannelLike | null = null
    let client: SupabaseClientLike | null = null

    async function setup() {
      client = supabaseClient ?? (await loadDefaultSupabase())
      if (cancelled || !client) return

      channel = client
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'Notification',
            filter: `userId=eq.${userId}`,
          },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              const incoming = rowToNotification(payload.new)
              if (!incoming) return
              // Dedupe + unread increment se hacen atómicamente dentro
              // del updater de `setNotifications` para que múltiples
              // INSERTs sincrónicos del mismo id no incrementen el
              // counter dos veces (escenario: latido replay del canal).
              setNotifications((prev) => {
                if (prev.some((n) => n.id === incoming.id)) return prev
                if (!incoming.readAt) {
                  setUnreadCount((c) => c + 1)
                }
                return [incoming, ...prev].slice(0, limit)
              })
            } else if (payload.eventType === 'UPDATE') {
              const updated = rowToNotification(payload.new)
              if (!updated) return
              setNotifications((prev) =>
                prev.map((n) => (n.id === updated.id ? updated : n)),
              )
              // Recount: cualquier UPDATE puede afectar readAt.
              const previous = notificationsRef.current.find(
                (n) => n.id === updated.id,
              )
              if (previous && !previous.readAt && updated.readAt) {
                setUnreadCount((c) => Math.max(0, c - 1))
              }
            } else if (payload.eventType === 'DELETE') {
              const oldId =
                payload.old && typeof payload.old.id === 'string'
                  ? payload.old.id
                  : null
              if (!oldId) return
              setNotifications((prev) => {
                const removed = prev.find((n) => n.id === oldId)
                if (removed && !removed.readAt) {
                  setUnreadCount((c) => Math.max(0, c - 1))
                }
                return prev.filter((n) => n.id !== oldId)
              })
            }
          },
        )
        .subscribe((status: string) => {
          setIsConnected(status === 'SUBSCRIBED')
        })
    }

    setup()

    return () => {
      cancelled = true
      if (client && channel) {
        client.removeChannel(channel).catch(() => {})
      }
      setIsConnected(false)
    }
  }, [enableRealtime, userId, supabaseClient, limit])

  const markAsRead = useCallback(
    async (id: string) => {
      const previous = notificationsRef.current
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id && !n.readAt
            ? { ...n, readAt: new Date().toISOString() }
            : n,
        ),
      )
      const wasUnread = previous.some((n) => n.id === id && !n.readAt)
      if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1))

      try {
        await markNotificationRead(id, userId ?? null)
      } catch (err) {
        console.error('[useNotificationsRealtime] markAsRead', err)
        // Reconcilia con server.
        await refresh()
      }
    },
    [userId, refresh],
  )

  const markAllAsRead = useCallback(async () => {
    const previousNotifications = notificationsRef.current
    const previousCount = unreadCount
    setNotifications((prev) =>
      prev.map((n) =>
        n.readAt ? n : { ...n, readAt: new Date().toISOString() },
      ),
    )
    setUnreadCount(0)
    try {
      await markAllNotificationsRead(userId ?? null)
    } catch (err) {
      console.error('[useNotificationsRealtime] markAllAsRead', err)
      setNotifications(previousNotifications)
      setUnreadCount(previousCount)
    }
  }, [userId, unreadCount])

  return useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      isConnected,
      refresh,
      markAsRead,
      markAllAsRead,
    }),
    [
      notifications,
      unreadCount,
      loading,
      isConnected,
      refresh,
      markAsRead,
      markAllAsRead,
    ],
  )
}
