'use client'

/**
 * HU-07 (2026-05-14) · Seguimiento de moderador.
 *
 * Hook que sincroniza el viewport (pan + zoom) de una pizarra entre un
 * "host" que comparte su vista y N "viewers" que siguen al host.
 *
 * Diseño:
 *   - Canal Supabase Realtime con nombre `whiteboard-follow:{id}`.
 *   - El host emite `event: 'host:viewport'` cada vez que su viewport
 *     cambia (con throttle de 80ms para no saturar el broadcast).
 *   - Los viewers reciben todos los eventos host y los guardan en un
 *     Map<userId, viewport+name>. El consumidor decide si seguir a
 *     un host específico (UX: click en "Seguir a X").
 *   - Cuando hay un `followingHostId` set, el callback `onViewportFromHost`
 *     se invoca con cada update — el caller aplica al viewport local.
 *
 * Reusa el patrón de `use-live-cursors` (factory injection, throttle,
 * cleanup en unmount con removeChannel).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { throttle, type ThrottledFn } from '@/lib/realtime-cursors/throttle'

const FOLLOW_BROADCAST_THROTTLE_MS = 80
const HOST_VIEWPORT_EVENT = 'host:viewport'
const HOST_LEAVE_EVENT = 'host:leave'

export type FollowViewport = {
  panX: number
  panY: number
  zoom: number
}

export type FollowHost = {
  userId: string
  name: string
  viewport: FollowViewport
  lastSeen: number
}

export type FollowIdentity = {
  id: string
  name: string
}

type RealtimeChannelLike = {
  on: (
    type: 'broadcast',
    filter: { event: string },
    callback: (payload: { payload: Record<string, unknown> }) => void,
  ) => RealtimeChannelLike
  subscribe: (cb?: (status: string) => void) => RealtimeChannelLike
  send: (args: {
    type: 'broadcast'
    event: string
    payload: unknown
  }) => Promise<unknown> | unknown
  unsubscribe: () => Promise<unknown> | unknown
}

type RealtimeClientLike = {
  channel: (name: string, options?: unknown) => RealtimeChannelLike
  removeChannel: (channel: RealtimeChannelLike) => Promise<unknown> | unknown
}

async function resolveSupabaseClient(): Promise<RealtimeClientLike | null> {
  if (typeof window === 'undefined') return null
  try {
    const mod = await import('@/lib/realtime/supabase-client')
    return (mod.getBrowserClient() as unknown as RealtimeClientLike) ?? null
  } catch {
    return null
  }
}

type Options = {
  channelName: string | null
  currentUser: FollowIdentity | null
  /** Si está true, emitimos nuestro viewport como host. */
  isHosting: boolean
  /** Viewport actual del usuario (se emite cuando isHosting). */
  viewport: FollowViewport
  /** Id del host que estamos siguiendo (null = no sigo a nadie). */
  followingHostId: string | null
  /** Callback al recibir un update del host que estamos siguiendo. */
  onViewportFromHost?: (v: FollowViewport) => void
  /** Inyección de cliente para testing. */
  injectedClientFactory?: () => Promise<RealtimeClientLike | null>
}

export function useWhiteboardFollow({
  channelName,
  currentUser,
  isHosting,
  viewport,
  followingHostId,
  onViewportFromHost,
  injectedClientFactory,
}: Options): {
  hosts: FollowHost[]
} {
  const [hosts, setHosts] = useState<FollowHost[]>([])
  const hostsMapRef = useRef<Map<string, FollowHost>>(new Map())
  const channelRef = useRef<RealtimeChannelLike | null>(null)
  const clientRef = useRef<RealtimeClientLike | null>(null)
  const currentUserRef = useRef(currentUser)
  const onViewportFromHostRef = useRef(onViewportFromHost)
  const followingHostIdRef = useRef(followingHostId)
  const isHostingRef = useRef(isHosting)
  const viewportRef = useRef(viewport)

  useEffect(() => {
    currentUserRef.current = currentUser
  }, [currentUser])
  useEffect(() => {
    onViewportFromHostRef.current = onViewportFromHost
  }, [onViewportFromHost])
  useEffect(() => {
    followingHostIdRef.current = followingHostId
  }, [followingHostId])
  useEffect(() => {
    isHostingRef.current = isHosting
  }, [isHosting])
  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  // ---- Subscripción al canal ---------------------------------------
  useEffect(() => {
    if (!channelName) return
    let cancelled = false
    const hostsMap = hostsMapRef.current

    const factory = injectedClientFactory ?? resolveSupabaseClient
    void factory().then((client) => {
      if (cancelled || !client) return
      clientRef.current = client
      const channel = client.channel(channelName, {
        config: { broadcast: { self: false } },
      } as unknown as undefined)

      channel
        .on('broadcast', { event: HOST_VIEWPORT_EVENT }, ({ payload }) => {
          if (!payload || typeof payload !== 'object') return
          const p = payload as {
            userId?: string
            name?: string
            panX?: number
            panY?: number
            zoom?: number
          }
          if (!p.userId || !p.name) return
          const me = currentUserRef.current
          if (me && p.userId === me.id) return
          const host: FollowHost = {
            userId: p.userId,
            name: p.name,
            viewport: {
              panX: typeof p.panX === 'number' ? p.panX : 0,
              panY: typeof p.panY === 'number' ? p.panY : 0,
              zoom: typeof p.zoom === 'number' ? p.zoom : 1,
            },
            lastSeen: Date.now(),
          }
          hostsMap.set(p.userId, host)
          setHosts(Array.from(hostsMap.values()))
          // Si estoy siguiendo a este host, aplico el viewport.
          if (followingHostIdRef.current === p.userId) {
            onViewportFromHostRef.current?.(host.viewport)
          }
        })
        .on('broadcast', { event: HOST_LEAVE_EVENT }, ({ payload }) => {
          if (!payload || typeof payload !== 'object') return
          const p = payload as { userId?: string }
          if (!p.userId) return
          if (hostsMap.delete(p.userId)) {
            setHosts(Array.from(hostsMap.values()))
          }
        })
        .subscribe()
      channelRef.current = channel
    })

    return () => {
      cancelled = true
      // Si estábamos hosting, anunciamos leave.
      const me = currentUserRef.current
      const ch = channelRef.current
      const cl = clientRef.current
      if (ch && me && isHostingRef.current) {
        try {
          void ch.send({
            type: 'broadcast',
            event: HOST_LEAVE_EVENT,
            payload: { userId: me.id },
          })
        } catch {
          /* noop */
        }
      }
      if (ch && cl) {
        try {
          void cl.removeChannel(ch)
        } catch {
          /* noop */
        }
      }
      channelRef.current = null
      clientRef.current = null
      hostsMap.clear()
    }
  }, [channelName, currentUser?.id, injectedClientFactory])

  // ---- Sender (host) throttled -------------------------------------
  const throttledRef = useRef<ThrottledFn<[FollowViewport]> | null>(null)
  useEffect(() => {
    const t = throttle((v: FollowViewport) => {
      const me = currentUserRef.current
      const ch = channelRef.current
      if (!ch || !me || !isHostingRef.current) return
      try {
        void ch.send({
          type: 'broadcast',
          event: HOST_VIEWPORT_EVENT,
          payload: {
            userId: me.id,
            name: me.name,
            panX: v.panX,
            panY: v.panY,
            zoom: v.zoom,
          },
        })
      } catch {
        /* noop */
      }
    }, FOLLOW_BROADCAST_THROTTLE_MS)
    throttledRef.current = t
  }, [])

  // Emit cuando cambia el viewport y estamos hosting.
  useEffect(() => {
    if (!isHosting) return
    const t = throttledRef.current
    if (!t) return
    t(viewport)
  }, [isHosting, viewport])

  // Emit leave inmediato cuando se desactiva el hosting (no esperamos a
  // unmount).
  useEffect(() => {
    if (isHosting) return
    const ch = channelRef.current
    const me = currentUserRef.current
    if (!ch || !me) return
    try {
      void ch.send({
        type: 'broadcast',
        event: HOST_LEAVE_EVENT,
        payload: { userId: me.id },
      })
    } catch {
      /* noop */
    }
  }, [isHosting])

  return useMemo(() => ({ hosts }), [hosts])
}
