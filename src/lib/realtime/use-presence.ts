'use client'

/**
 * usePresence · Hook de presence sobre Supabase Realtime.
 *
 * Wave P6 · Equipo A1.
 *
 * Comportamiento:
 * - Suscribe a `channelName` con `presence.enabled=true`.
 * - Llama a `track(identity)` apenas el channel está READY, y a `untrack()`
 *   en cleanup.
 * - Mantiene la lista actualizada con los eventos `presence:sync|join|leave`.
 * - Heartbeat cada `PRESENCE_HEARTBEAT_MS`: re-track con `lastSeen` actual
 *   para que el server propague que seguimos vivos (también ayuda a
 *   detectar tabs zombie sin desconexión limpia).
 * - Si el cliente Supabase no está disponible (env vars ausentes), el hook
 *   retorna lista vacía y `isOnline=false` (no-op).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getBrowserClient } from './supabase-client'
import {
  PRESENCE_HEARTBEAT_MS,
  type PresenceIdentity,
  type PresenceState,
  type PresenceUser,
} from './types'

const INITIAL_STATE: PresenceState = {
  users: [],
  me: null,
  isOnline: false,
}

/**
 * Convierte el `presenceState` plano del SDK
 * (`{ key: [{...meta}, {...meta}] }`) en una lista plana de usuarios
 * únicos por `userId`. Si un mismo userId tiene múltiples presencias
 * (e.g. dos tabs abiertas), nos quedamos con la más reciente por
 * `lastSeen`.
 */
function flattenPresenceState(
  raw: Record<string, Array<Record<string, unknown>>>
): PresenceUser[] {
  const byId = new Map<string, PresenceUser>()
  for (const presences of Object.values(raw)) {
    for (const meta of presences) {
      const u = meta as unknown as PresenceUser
      if (!u || typeof u.userId !== 'string') continue
      const prev = byId.get(u.userId)
      if (!prev || (u.lastSeen && prev.lastSeen && u.lastSeen > prev.lastSeen)) {
        byId.set(u.userId, u)
      }
    }
  }
  return Array.from(byId.values())
}

export function usePresence(
  channelName: string | null,
  identity: PresenceIdentity | null
): PresenceState {
  const [state, setState] = useState<PresenceState>(INITIAL_STATE)
  // Guardamos identity en ref para que el heartbeat use el último valor sin
  // re-suscribir el channel cuando cambia (e.g. el usuario edita su nombre).
  // La asignación va en `useEffect` (no en cuerpo del componente) para no
  // mutar refs durante el render — regla `react-hooks/refs`.
  const identityRef = useRef<PresenceIdentity | null>(identity)
  useEffect(() => {
    identityRef.current = identity
  }, [identity])

  // Clave estable para detectar cambios reales en la identidad. Sólo si
  // userId cambia (logout/login) re-tracking pleno; otros campos se
  // propagan por heartbeat.
  const identityKey = useMemo(() => identity?.userId ?? null, [identity?.userId])

  useEffect(() => {
    if (!channelName || !identityKey) {
      // Reset diferido para no llamar setState síncronamente dentro del
      // cuerpo del efecto (regla `react-hooks/set-state-in-effect` R19).
      const tid = setTimeout(() => setState(INITIAL_STATE), 0)
      return () => clearTimeout(tid)
    }
    const client = getBrowserClient()
    if (!client) {
      const tid = setTimeout(() => setState(INITIAL_STATE), 0)
      return () => clearTimeout(tid)
    }

    const channel: RealtimeChannel = client.channel(channelName, {
      config: { presence: { key: identityKey, enabled: true } },
    })

    let cancelled = false
    let heartbeat: ReturnType<typeof setInterval> | null = null

    function buildMe(): PresenceUser | null {
      const id = identityRef.current
      if (!id) return null
      return {
        ...id,
        status: id.status ?? 'online',
        lastSeen: new Date().toISOString(),
      }
    }

    function syncFromChannel() {
      if (cancelled) return
      const raw = channel.presenceState() as unknown as Record<
        string,
        Array<Record<string, unknown>>
      >
      const users = flattenPresenceState(raw)
      const me = buildMe()
      const isOnline = me ? users.some((u) => u.userId === me.userId) : false
      setState({ users, me, isOnline })
    }

    channel
      .on('presence', { event: 'sync' }, syncFromChannel)
      .on('presence', { event: 'join' }, syncFromChannel)
      .on('presence', { event: 'leave' }, syncFromChannel)
      .subscribe(async (status) => {
        if (cancelled) return
        if (status === 'SUBSCRIBED') {
          const me = buildMe()
          if (me) await channel.track(me)
        }
      })

    heartbeat = setInterval(async () => {
      if (cancelled) return
      const me = buildMe()
      if (me) await channel.track(me)
    }, PRESENCE_HEARTBEAT_MS)

    return () => {
      cancelled = true
      if (heartbeat) clearInterval(heartbeat)
      // `untrack` propaga el `leave` antes de remover el channel.
      void channel.untrack().finally(() => {
        void client.removeChannel(channel)
      })
    }
  }, [channelName, identityKey])

  return state
}
