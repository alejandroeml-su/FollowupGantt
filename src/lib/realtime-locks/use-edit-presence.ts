'use client'

/**
 * Wave P6 · Equipo A5 — `useEditPresence`.
 *
 * Hook que combina Supabase Realtime *presence* + *broadcast* sobre un canal
 * `<entity>:<id>:edit` para implementar **edit indicators con soft lock**:
 *
 *   - cada cliente publica su `EditingPresenceMeta` mediante `track()`.
 *   - `startEditing()` enciende el flag `isEditing` y arranca un heartbeat
 *     cada `heartbeatIntervalMs` (default 5s) que se replica en presence.
 *   - los peers detectan stale-locks: si el `heartbeatAt` de un usuario no se
 *     actualiza en los últimos `staleAfterMs` (default 30s), el cliente lo
 *     filtra silenciosamente — evita locks zombies por desconexión bruta.
 *   - `forceOverride()` emite broadcast `lock:override_requested` para que
 *     el resto vea quién tomó el control y arranca el lock local sin esperar
 *     a que el otro libere (semánticamente: último que pulsa "Forzar" gana,
 *     la BD sigue siendo last-write-wins).
 *
 * ### Degradación
 *   Si `NEXT_PUBLIC_SUPABASE_URL` falta, `createChannel` retorna null y el
 *   hook se comporta como un no-op: `isLockedByOther=false`, `editingUsers=[]`,
 *   `start/stop/force` son funciones idempotentes que no rompen al caller.
 *
 * ### Compatibilidad con tests
 *   Aceptamos un `client` opcional vía argumento (ver tests). Si no se pasa,
 *   se importa diferido el cliente global de `@/lib/supabase` para no
 *   bloquear el SSR cuando no haya URL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type {
  EditPresenceState,
  EditingPresenceMeta,
  EditingUser,
  UseEditPresenceOptions,
} from './types'

// Mínimo subconjunto del cliente de Supabase que necesitamos. Lo declaramos
// localmente para poder inyectarlo en tests sin levantar todo `@supabase/supabase-js`.
type RealtimeClientLike = {
  channel(name: string, opts?: Record<string, unknown>): RealtimeChannel
  removeChannel(channel: RealtimeChannel): unknown
}

const DEFAULT_HEARTBEAT_MS = 5_000
const DEFAULT_STALE_MS = 30_000

/** Detecta si Supabase Realtime está disponible (URL configurada). */
function isRealtimeConfigured(): boolean {
  if (typeof process === 'undefined') return false
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  return typeof url === 'string' && url.length > 0
}

/**
 * @param channelName  ej. `task:42:edit`. Único por entidad editable.
 * @param currentUser  identidad del usuario activo en el cliente.
 * @param options      heartbeat + stale window + callback de override.
 * @param injectedClient (sólo tests) cliente Realtime mockeable.
 */
export function useEditPresence(
  channelName: string,
  currentUser: EditingUser,
  options: UseEditPresenceOptions = {},
  injectedClient?: RealtimeClientLike,
): EditPresenceState {
  const {
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
    staleAfterMs = DEFAULT_STALE_MS,
    onOverrideRequested,
  } = options

  const [editingUsers, setEditingUsers] = useState<EditingUser[]>([])
  const [isCurrentUserEditing, setIsCurrentUserEditing] = useState(false)
  const [isRealtimeAvailable, setIsRealtimeAvailable] = useState(false)

  // Refs estables — evitan re-suscripciones por cambios de identidad de objetos.
  const channelRef = useRef<RealtimeChannel | null>(null)
  const isEditingRef = useRef(false)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const overrideCbRef = useRef<typeof onOverrideRequested>(onOverrideRequested)
  const userRef = useRef<EditingUser>(currentUser)

  // Mantenemos refs sincronizadas para que el callback que se cierra sobre
  // ellas siempre vea el último callback/usuario sin tener que re-suscribir.
  useEffect(() => {
    overrideCbRef.current = onOverrideRequested
  }, [onOverrideRequested])
  useEffect(() => {
    userRef.current = currentUser
  }, [currentUser])

  /** Construye el snapshot inicial de meta para `track()`. */
  const buildMeta = useCallback(
    (isEditing: boolean): EditingPresenceMeta => {
      const now = new Date().toISOString()
      return {
        user: userRef.current,
        isEditing,
        since: now,
        heartbeatAt: now,
      }
    },
    [],
  )

  /**
   * Recalcula `editingUsers` a partir del estado de presence actual del canal,
   * filtrando: (a) al usuario actual, (b) entradas con `isEditing=false`,
   * (c) entradas cuyo heartbeat es más viejo que `staleAfterMs`.
   */
  const refreshFromPresence = useCallback(() => {
    const channel = channelRef.current
    if (!channel) {
      setEditingUsers([])
      return
    }
    const state = channel.presenceState<EditingPresenceMeta>()
    const now = Date.now()
    const acc: EditingUser[] = []
    for (const key of Object.keys(state)) {
      const entries = state[key]
      if (!entries || entries.length === 0) continue
      // En presence, cada `key` puede tener múltiples entries (re-conexiones);
      // tomamos la más reciente por heartbeat.
      const latest = entries.reduce((a, b) =>
        new Date(a.heartbeatAt).getTime() > new Date(b.heartbeatAt).getTime()
          ? a
          : b,
      )
      if (!latest.isEditing) continue
      if (latest.user.id === userRef.current.id) continue
      const hbAge = now - new Date(latest.heartbeatAt).getTime()
      if (hbAge > staleAfterMs) continue
      acc.push(latest.user)
    }
    setEditingUsers(acc)
  }, [staleAfterMs])

  // Suscripción al canal. Una sola vez por (channelName, user.id).
  useEffect(() => {
    if (!channelName) return
    const client: RealtimeClientLike | undefined =
      injectedClient ??
      (isRealtimeConfigured()
        ? (supabase as unknown as RealtimeClientLike)
        : undefined)

    if (!client) {
      // No-op: sin cliente, el estado por defecto (`false`) ya refleja la
      // realidad. Evitamos `setState` aquí para cumplir la regla
      // `react-hooks/set-state-in-effect`.
      return
    }

    const channel = client.channel(channelName, {
      config: { presence: { key: userRef.current.id } },
    })
    channelRef.current = channel

    channel.on('presence', { event: 'sync' }, () => {
      refreshFromPresence()
    })
    channel.on('presence', { event: 'join' }, () => {
      refreshFromPresence()
    })
    channel.on('presence', { event: 'leave' }, () => {
      refreshFromPresence()
    })
    channel.on(
      'broadcast',
      { event: 'lock:override_requested' },
      (msg: { payload?: { from?: EditingUser } }) => {
        const from = msg.payload?.from
        if (!from || from.id === userRef.current.id) return
        overrideCbRef.current?.(from)
      },
    )

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setIsRealtimeAvailable(true)
        // Anunciamos presencia inicial como "viendo" (no editando).
        void channel.track(buildMeta(false))
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setIsRealtimeAvailable(false)
      }
    })

    return () => {
      // React 19 cleanup pattern: idempotente.
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
      try {
        client.removeChannel(channel)
      } catch {
        // si el canal ya fue removido (HMR / unmount doble) ignoramos
      }
      if (channelRef.current === channel) {
        channelRef.current = null
      }
      setIsRealtimeAvailable(false)
    }
  }, [channelName, injectedClient, buildMeta, refreshFromPresence])

  // Refresh periódico para que las entradas stale desaparezcan aún cuando no
  // lleguen eventos presence (otro peer cayó sin desuscribirse).
  useEffect(() => {
    if (!isRealtimeAvailable) return
    const t = setInterval(refreshFromPresence, Math.max(1_000, heartbeatIntervalMs))
    return () => clearInterval(t)
  }, [isRealtimeAvailable, heartbeatIntervalMs, refreshFromPresence])

  const startEditing = useCallback(() => {
    if (isEditingRef.current) return
    isEditingRef.current = true
    setIsCurrentUserEditing(true)
    const channel = channelRef.current
    if (!channel) return
    void channel.track(buildMeta(true))
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
    heartbeatTimerRef.current = setInterval(() => {
      const ch = channelRef.current
      if (!ch || !isEditingRef.current) return
      const meta = buildMeta(true)
      void ch.track(meta)
    }, heartbeatIntervalMs)
  }, [buildMeta, heartbeatIntervalMs])

  const stopEditing = useCallback(() => {
    if (!isEditingRef.current) return
    isEditingRef.current = false
    setIsCurrentUserEditing(false)
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
    const channel = channelRef.current
    if (!channel) return
    void channel.track(buildMeta(false))
    void channel.send({
      type: 'broadcast',
      event: 'lock:released',
      payload: { from: userRef.current, at: new Date().toISOString() },
    })
  }, [buildMeta])

  const forceOverride = useCallback(() => {
    const channel = channelRef.current
    // Tomamos lock local incluso si el canal no está listo (degradación
    // segura: el usuario no queda atascado en modo "solo lectura").
    if (!isEditingRef.current) {
      isEditingRef.current = true
      setIsCurrentUserEditing(true)
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = setInterval(() => {
        const ch = channelRef.current
        if (!ch || !isEditingRef.current) return
        void ch.track(buildMeta(true))
      }, heartbeatIntervalMs)
    }
    if (!channel) return
    void channel.track(buildMeta(true))
    void channel.send({
      type: 'broadcast',
      event: 'lock:override_requested',
      payload: { from: userRef.current, at: new Date().toISOString() },
    })
  }, [buildMeta, heartbeatIntervalMs])

  const isLockedByOther = useMemo(
    () => editingUsers.length > 0 && !isCurrentUserEditing,
    [editingUsers, isCurrentUserEditing],
  )

  return {
    editingUsers,
    isLockedByOther,
    isCurrentUserEditing,
    startEditing,
    stopEditing,
    forceOverride,
    isRealtimeAvailable,
  }
}
