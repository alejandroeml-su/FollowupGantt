'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { throttle, type ThrottledFn } from './throttle'

/**
 * Paleta de colores asignados deterministamente por hash del userId.
 * Mantener exactamente 8 entradas — el hash hace `mod 8` para escoger.
 * Tomada del diseño aprobado en Wave P6 (live cursors).
 */
export const CURSOR_PALETTE = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#6366f1',
  '#a855f7',
  '#ec4899',
] as const

/** Throttle por defecto (ms) para el envío de posiciones por broadcast. */
export const CURSOR_BROADCAST_THROTTLE_MS = 50

/** Posición de un cursor remoto, lista para renderizar. */
export type CursorPosition = {
  userId: string
  name: string
  x: number
  y: number
  color: string
}

/** Identidad mínima del usuario actual para no auto-renderizar el cursor. */
export type CurrentUserIdentity = {
  id: string
  name: string
}

/** Hash determinista (djb2) — fnv-like — para mapear userId → palette. */
export function colorForUserId(userId: string): string {
  let hash = 5381
  for (let i = 0; i < userId.length; i++) {
    // hash * 33 ^ char
    hash = ((hash << 5) + hash) ^ userId.charCodeAt(i)
  }
  // Forzamos uint32 antes del modulo.
  const idx = Math.abs(hash >>> 0) % CURSOR_PALETTE.length
  return CURSOR_PALETTE[idx]
}

/** Eventos de broadcast emitidos por el hook. */
const CURSOR_EVENT = 'cursor:move' as const
const CURSOR_LEAVE_EVENT = 'cursor:leave' as const

/**
 * Mínima forma del cliente Supabase que necesitamos. Se inyecta así para
 * facilitar tests sin levantar el SDK real, y para degradar a no-op si
 * el cliente no está disponible (env vars ausentes).
 */
type RealtimeChannelLike = {
  on: (
    type: 'broadcast',
    filter: { event: string },
    cb: (payload: { payload: CursorPosition }) => void,
  ) => RealtimeChannelLike
  subscribe: (cb?: (status: string) => void) => RealtimeChannelLike
  send: (args: { type: 'broadcast'; event: string; payload: unknown }) => Promise<unknown> | unknown
  unsubscribe: () => Promise<unknown> | unknown
}
type SupabaseClientLike = {
  channel: (name: string, opts?: unknown) => RealtimeChannelLike
  removeChannel: (channel: RealtimeChannelLike) => Promise<unknown> | unknown
}

/**
 * Resuelve el cliente Supabase **client-side** sin lanzar si las env
 * vars no están presentes (modo no-op en tests, SSR, o entornos sin
 * realtime habilitado).
 */
async function resolveSupabaseClient(): Promise<SupabaseClientLike | null> {
  if (typeof window === 'undefined') return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  try {
    const mod = await import('@supabase/supabase-js')
    return mod.createClient(url, anonKey, {
      realtime: { params: { eventsPerSecond: 30 } },
    }) as unknown as SupabaseClientLike
  } catch {
    return null
  }
}

/** Permite tests inyectar un cliente fake sin tocar env vars. */
let injectedClientFactory: (() => Promise<SupabaseClientLike | null>) | null = null

/**
 * @internal — uso exclusivo en tests. Inyecta un cliente Supabase falso
 * o `null` para forzar el camino no-op. Llama a `__resetLiveCursorsClient()`
 * en el `afterEach` para no contaminar otros tests.
 */
export function __setLiveCursorsClientFactory(
  factory: (() => Promise<SupabaseClientLike | null>) | null,
) {
  injectedClientFactory = factory
}

export function __resetLiveCursorsClient() {
  injectedClientFactory = null
}

export type UseLiveCursorsResult = {
  /** Cursores remotos (excluye al currentUser). Estable referencialmente entre frames. */
  cursors: CursorPosition[]
  /** Envía la posición del cursor local. Throttled internamente. */
  sendPosition: (x: number, y: number) => void
  /** Color asignado al currentUser (consistente con remotos). */
  selfColor: string
}

/**
 * Hook auto-contenido para cursores en vivo.
 *
 * Suscribe a un canal Supabase Realtime y escucha eventos broadcast
 * `cursor:move`. Mantiene un mapa por `userId` y lo expone como array.
 * Excluye al `currentUser` para no auto-renderizar.
 *
 * Diseño:
 *   - `sendPosition` queda **estable** entre renders gracias a useRef +
 *     useMemo. El consumidor puede atarla a un listener nativo sin
 *     re-suscribirse cada frame.
 *   - Throttle por defecto a 50 ms (`CURSOR_BROADCAST_THROTTLE_MS`).
 *   - Si Supabase no está disponible (env vars ausentes, módulo no
 *     instalado, error de import) el hook degrada a no-op silencioso:
 *     `cursors` queda `[]` y `sendPosition` no hace nada. Esto evita
 *     romper la UI en preview/tests sin realtime.
 *   - Cleanup en unmount: `unsubscribe` + `removeChannel`. Cancela
 *     timers pendientes del throttle.
 */
export function useLiveCursors(
  channelName: string,
  currentUser: CurrentUserIdentity | null,
  options?: { throttleMs?: number },
): UseLiveCursorsResult {
  const throttleMs = options?.throttleMs ?? CURSOR_BROADCAST_THROTTLE_MS
  const [cursors, setCursors] = useState<CursorPosition[]>([])
  // Refs para que `sendPosition` permanezca estable y para que cleanups
  // no peleen con renders concurrentes (React 19).
  const channelRef = useRef<RealtimeChannelLike | null>(null)
  const clientRef = useRef<SupabaseClientLike | null>(null)
  const cursorsMapRef = useRef<Map<string, CursorPosition>>(new Map())
  const currentUserRef = useRef<CurrentUserIdentity | null>(currentUser)
  // Sincronizamos en effect (no en render) para cumplir `react-hooks/refs`.
  useEffect(() => {
    currentUserRef.current = currentUser
  }, [currentUser])

  const selfColor = useMemo(
    () => (currentUser ? colorForUserId(currentUser.id) : CURSOR_PALETTE[0]),
    [currentUser],
  )

  // ---- Subscripción al canal --------------------------------------------
  useEffect(() => {
    let cancelled = false
    // Snapshot del Map al iniciar el efecto, para usar el mismo en
    // cleanup y evitar la advertencia react-hooks/exhaustive-deps.
    const cursorsMap = cursorsMapRef.current

    const factory = injectedClientFactory ?? resolveSupabaseClient
    void factory().then((client) => {
      if (cancelled || !client) return
      clientRef.current = client
      const channel = client.channel(channelName, {
        config: { broadcast: { self: false } },
      } as unknown as undefined)

      channel
        .on('broadcast', { event: CURSOR_EVENT }, ({ payload }) => {
          if (!payload || typeof payload !== 'object') return
          const me = currentUserRef.current
          if (me && payload.userId === me.id) return
          cursorsMap.set(payload.userId, payload)
          // Trigger render con un nuevo array (referencia distinta).
          setCursors(Array.from(cursorsMap.values()))
        })
        .on('broadcast', { event: CURSOR_LEAVE_EVENT }, ({ payload }) => {
          if (!payload || typeof payload !== 'object') return
          if (cursorsMap.delete(payload.userId)) {
            setCursors(Array.from(cursorsMap.values()))
          }
        })
        .subscribe()
      channelRef.current = channel
    })

    return () => {
      cancelled = true
      const ch = channelRef.current
      const cl = clientRef.current
      if (ch && cl) {
        try {
          void cl.removeChannel(ch)
        } catch {
          /* noop */
        }
      }
      channelRef.current = null
      clientRef.current = null
      cursorsMap.clear()
    }
    // currentUser cambia poco; channelName es la fuente de verdad de la
    // suscripción. Si cambia el user (logout/login) re-creamos canal —
    // así filtramos correctamente nuestro propio userId.
  }, [channelName, currentUser?.id])

  // ---- Sender estable + throttle ----------------------------------------
  // Guardamos la función throttled en un ref creado dentro de un effect,
  // así nunca leemos refs ni instanciamos el throttle durante render
  // (cumple `react-hooks/refs` y `set-state-in-effect`).
  const throttledRef = useRef<ThrottledFn<[number, number]> | null>(null)
  useEffect(() => {
    const t = throttle((x: number, y: number) => {
      const me = currentUserRef.current
      const ch = channelRef.current
      if (!ch || !me) return
      const payload: CursorPosition = {
        userId: me.id,
        name: me.name,
        x,
        y,
        color: colorForUserId(me.id),
      }
      try {
        void ch.send({ type: 'broadcast', event: CURSOR_EVENT, payload })
      } catch {
        /* noop — no rompemos el ratón si el canal cae */
      }
    }, throttleMs)
    throttledRef.current = t
    return () => {
      t.cancel()
      throttledRef.current = null
    }
  }, [throttleMs])

  // `sendPosition` es estable: delega en el ref. Cumple "no setState en
  // render" y el listener no necesita re-suscribirse cuando cambian deps.
  const sendPosition = useCallback((x: number, y: number) => {
    throttledRef.current?.(x, y)
  }, [])

  return { cursors, sendPosition, selfColor }
}
