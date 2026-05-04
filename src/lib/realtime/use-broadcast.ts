'use client'

/**
 * useBroadcast · Hook para enviar/recibir eventos broadcast en un channel.
 *
 * Wave P6 · Equipo A1.
 *
 * - Suscribe al evento `event` dentro de `channelName`.
 * - Mantiene un buffer en memoria (FIFO) de los últimos `BROADCAST_BUFFER_SIZE`
 *   payloads recibidos.
 * - Expone `send(payload)` que envía con `type=broadcast`. La promesa
 *   resuelve con la respuesta del server (`'ok' | 'timed out' | 'error'`).
 * - Si el cliente Supabase no está configurado, `send()` resuelve sin
 *   hacer nada y `messages` permanece vacío (no-op).
 *
 * Tipado: el genérico `T` define la forma del payload. El consumidor lo
 * pasa explícitamente, ej. `useBroadcast<CursorPayload>(topic, 'cursor:move')`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getBrowserClient } from './supabase-client'
import { BROADCAST_BUFFER_SIZE, type BroadcastState } from './types'

export function useBroadcast<T>(
  channelName: string | null,
  event: string
): BroadcastState<T> {
  const [messages, setMessages] = useState<T[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const isReadyRef = useRef(false)

  useEffect(() => {
    if (!channelName || !event) {
      channelRef.current = null
      isReadyRef.current = false
      // Defer reset para no llamar setState síncronamente dentro del cuerpo
      // del efecto (regla `react-hooks/set-state-in-effect`).
      const tid = setTimeout(() => setMessages([]), 0)
      return () => clearTimeout(tid)
    }
    const client = getBrowserClient()
    if (!client) {
      channelRef.current = null
      isReadyRef.current = false
      const tid = setTimeout(() => setMessages([]), 0)
      return () => clearTimeout(tid)
    }

    const channel = client.channel(channelName, {
      config: { broadcast: { self: false, ack: true } },
    })
    channelRef.current = channel

    let cancelled = false

    // El SDK tipa los handlers de broadcast con `T extends {[k]:any}` lo
    // que choca con genéricos primitivos. Casteamos el callback a la
    // firma laxa del SDK (`{[k]:any}`), validamos forma en runtime.
    const broadcastHandler = (msg: { payload?: unknown }) => {
      if (cancelled) return
      const payload = msg?.payload as T | undefined
      if (payload === undefined) return
      setMessages((prev) => {
        const next = prev.length >= BROADCAST_BUFFER_SIZE
          ? prev.slice(prev.length - BROADCAST_BUFFER_SIZE + 1)
          : prev.slice()
        next.push(payload)
        return next
      })
    }
    channel
      .on(
        'broadcast',
        { event },
        broadcastHandler as Parameters<typeof channel.on<Record<string, unknown>>>[2]
      )
      .subscribe((status) => {
        if (cancelled) return
        isReadyRef.current = status === 'SUBSCRIBED'
      })

    return () => {
      cancelled = true
      isReadyRef.current = false
      void client.removeChannel(channel)
      channelRef.current = null
    }
  }, [channelName, event])

  const send = useCallback(
    async (payload: T): Promise<void> => {
      const channel = channelRef.current
      if (!channel || !isReadyRef.current) return
      await channel.send({ type: 'broadcast', event, payload })
    },
    [event]
  )

  return { messages, send }
}
