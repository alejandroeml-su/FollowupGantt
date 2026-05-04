'use client'

/**
 * Wave P6 · Equipo A3 — Hook de "está escribiendo…" sobre Supabase Realtime
 * Broadcast.
 *
 * Decisiones:
 *   - `broadcast` (no `postgres_changes`) porque el "typing" es efímero,
 *     alto-volumen y no debe persistirse: encaja con el uso recomendado
 *     de Supabase Broadcast.
 *   - `setTyping(true)` re-emite cada 1s (refresh) mientras el usuario
 *     sigue tecleando para que los demás puedan caducarlo si dejamos de
 *     recibir refreshes (auto-stop tras 3s sin actividad por usuario).
 *   - `setTyping(false)` envía un `comment:stop_typing` y limpia los
 *     timers locales.
 *   - El `currentUser` se excluye siempre del array `typingUsers` (no nos
 *     mostramos a nosotros mismos).
 *   - Si Supabase no está configurado, todas las operaciones son no-op:
 *     `typingUsers` queda vacío y `setTyping` no envía nada.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type TypingUser = {
  id: string
  name: string
}

export type UseTypingIndicatorResult = {
  typingUsers: TypingUser[]
  setTyping: (isTyping: boolean) => void
}

const TYPING_REFRESH_MS = 1_000
const TYPING_TIMEOUT_MS = 3_000

type TypingMap = Record<string, { user: TypingUser; lastSeen: number }>

function isRealtimeConfigured(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  )
}

export function useTypingIndicator(
  channelName: string,
  currentUser: TypingUser | null,
): UseTypingIndicatorResult {
  const [typingMap, setTypingMap] = useState<TypingMap>({})
  const channelRef = useRef<RealtimeChannel | null>(null)
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const currentUserId = currentUser?.id ?? null

  // Subscripción y limpieza.
  useEffect(() => {
    if (!isRealtimeConfigured()) return
    // Captura local del ref para usar en cleanup (regla
    // react-hooks/exhaustive-deps: el `.current` puede haber cambiado para
    // cuando se ejecuta cleanup; lo congelamos en la cierre del effect).
    const timeouts = timeoutsRef.current
    let channel: RealtimeChannel | null = null
    try {
      channel = supabase
        .channel(channelName, { config: { broadcast: { self: false } } })
        .on(
          'broadcast',
          { event: 'comment:typing' },
          (msg: { payload?: { userId?: string; name?: string } }) => {
            const userId = msg?.payload?.userId
            const name = msg?.payload?.name ?? ''
            if (!userId) return
            if (userId === currentUserId) return
            const now = Date.now()
            setTypingMap((prev) => ({
              ...prev,
              [userId]: { user: { id: userId, name }, lastSeen: now },
            }))
            // Programar auto-stop si dejan de llegar refreshes.
            const existing = timeoutsRef.current.get(userId)
            if (existing) clearTimeout(existing)
            const t = setTimeout(() => {
              setTypingMap((prev) => {
                if (!prev[userId]) return prev
                const next = { ...prev }
                delete next[userId]
                return next
              })
              timeoutsRef.current.delete(userId)
            }, TYPING_TIMEOUT_MS)
            timeoutsRef.current.set(userId, t)
          },
        )
        .on(
          'broadcast',
          { event: 'comment:stop_typing' },
          (msg: { payload?: { userId?: string } }) => {
            const userId = msg?.payload?.userId
            if (!userId) return
            const t = timeoutsRef.current.get(userId)
            if (t) {
              clearTimeout(t)
              timeoutsRef.current.delete(userId)
            }
            setTypingMap((prev) => {
              if (!prev[userId]) return prev
              const next = { ...prev }
              delete next[userId]
              return next
            })
          },
        )
        .subscribe()
      channelRef.current = channel
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useTypingIndicator] subscribe failed', e)
      }
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
      for (const t of timeouts.values()) clearTimeout(t)
      timeouts.clear()
      if (channel) {
        try {
          supabase.removeChannel(channel)
        } catch {
          // ignore
        }
      }
      channelRef.current = null
    }
  }, [channelName, currentUserId])

  const sendTyping = useCallback(() => {
    const ch = channelRef.current
    if (!ch || !currentUser) return
    try {
      void ch.send({
        type: 'broadcast',
        event: 'comment:typing',
        payload: { userId: currentUser.id, name: currentUser.name },
      })
    } catch {
      // ignore
    }
  }, [currentUser])

  const sendStopTyping = useCallback(() => {
    const ch = channelRef.current
    if (!ch || !currentUser) return
    try {
      void ch.send({
        type: 'broadcast',
        event: 'comment:stop_typing',
        payload: { userId: currentUser.id },
      })
    } catch {
      // ignore
    }
  }, [currentUser])

  const setTyping = useCallback(
    (isTyping: boolean) => {
      if (!isRealtimeConfigured()) return
      if (!currentUser) return
      if (isTyping) {
        // Emisión inmediata + refresh cada 1s.
        sendTyping()
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current)
        }
        refreshIntervalRef.current = setInterval(() => {
          sendTyping()
        }, TYPING_REFRESH_MS)
      } else {
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current)
          refreshIntervalRef.current = null
        }
        sendStopTyping()
      }
    },
    [currentUser, sendTyping, sendStopTyping],
  )

  const typingUsers = useMemo<TypingUser[]>(() => {
    return Object.values(typingMap)
      .filter((entry) => entry.user.id !== currentUserId)
      .map((entry) => entry.user)
  }, [typingMap, currentUserId])

  return useMemo(
    () => ({ typingUsers, setTyping }),
    [typingUsers, setTyping],
  )
}
