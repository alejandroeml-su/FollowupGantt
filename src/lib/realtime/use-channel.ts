'use client'

/**
 * useChannel · Hook base para suscribirse a un channel de Supabase Realtime.
 *
 * Wave P6 · Equipo A1.
 *
 * Diseño:
 * - El hook NO conoce de presence ni broadcast: sólo gestiona el ciclo de
 *   vida del channel y reporta su estado. `usePresence` y `useBroadcast`
 *   se construyen encima.
 * - Si las env vars de Supabase no existen, el hook degrada a no-op:
 *   retorna `channel=null`, `isReady=false`, sin error. La app sigue
 *   funcionando sin Realtime.
 * - Cleanup automático en unmount: removemos el channel del cliente.
 *   Supabase reconecta por sí solo en caso de drop transitorio.
 * - Sin `useEffect → setState` síncrono: cuando hay que resetear el
 *   estado por cambio de inputs, el reset se difiere con `setTimeout(...,0)`
 *   para cumplir la regla `react-hooks/set-state-in-effect` de R19.
 * - El `channel` activo se guarda en estado, no en ref, para no leer refs
 *   durante render (regla `react-hooks/refs`).
 */
import { useEffect, useState } from 'react'
import type { RealtimeChannel, RealtimeChannelOptions } from '@supabase/supabase-js'
import { getBrowserClient } from './supabase-client'
import type { ChannelState } from './types'

export type UseChannelResult = ChannelState & {
  channel: RealtimeChannel | null
}

const INITIAL: ChannelState = {
  isReady: false,
  isConnected: false,
  error: null,
}

type Internal = ChannelState & { channel: RealtimeChannel | null }
const INITIAL_INTERNAL: Internal = { ...INITIAL, channel: null }

export function useChannel(
  channelName: string | null,
  options?: RealtimeChannelOptions
): UseChannelResult {
  const [internal, setInternal] = useState<Internal>(INITIAL_INTERNAL)

  // Serializamos las opciones a string para usarlo como dep estable de
  // `useEffect`. Evita re-suscribir el channel cuando el caller pasa un
  // objeto literal nuevo en cada render con el mismo contenido.
  const optionsKey = options ? JSON.stringify(options) : ''

  useEffect(() => {
    if (!channelName) {
      const tid = setTimeout(() => setInternal(INITIAL_INTERNAL), 0)
      return () => clearTimeout(tid)
    }

    const client = getBrowserClient()
    if (!client) {
      const tid = setTimeout(() => setInternal(INITIAL_INTERNAL), 0)
      return () => clearTimeout(tid)
    }

    const parsedOptions = optionsKey
      ? (JSON.parse(optionsKey) as RealtimeChannelOptions)
      : undefined
    const channel = client.channel(channelName, parsedOptions)

    let cancelled = false
    // Defer al microtask para no llamar setState síncronamente dentro del
    // cuerpo del efecto (regla `react-hooks/set-state-in-effect`).
    const initTid = setTimeout(() => {
      if (!cancelled) setInternal({ channel, ...INITIAL })
    }, 0)

    channel.subscribe((status, err) => {
      if (cancelled) return
      if (status === 'SUBSCRIBED') {
        setInternal({ channel, isReady: true, isConnected: true, error: null })
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setInternal({
          channel,
          isReady: false,
          isConnected: false,
          error: err ?? new Error(`Realtime ${status}`),
        })
      } else if (status === 'CLOSED') {
        setInternal({ channel, isReady: false, isConnected: false, error: null })
      }
    })

    return () => {
      cancelled = true
      clearTimeout(initTid)
      // `removeChannel` incluye unsubscribe + teardown del lado SDK.
      void client.removeChannel(channel)
    }
  }, [channelName, optionsKey])

  return internal
}
