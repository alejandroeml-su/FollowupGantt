'use client'

/**
 * Wave P6 · Equipo A4 — Hook para gestionar suscripción Web Push.
 *
 * Encapsula:
 *   - Detección de soporte (`Notification`, `serviceWorker`, `PushManager`).
 *   - Estado de permiso (`default | granted | denied`).
 *   - Estado de suscripción local (mediante `pushManager.getSubscription`).
 *   - Acciones `subscribe()` / `unsubscribe()` que llaman las server actions
 *     `subscribeToPush` / `unsubscribeFromPush` para persistir.
 *
 * Asume que `/sw.js` está registrado externamente (el shell de la app
 * registra el SW en P4-3 PWA). Si la registración no existe, `subscribe()`
 * espera con `navigator.serviceWorker.ready` (timeout 5s).
 *
 * VAPID public key viene de `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Si está vacía,
 * `subscribe()` lanza `[NO_VAPID]` para que la UI muestre instrucción de
 * configurar env vars.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/actions/push-subscriptions'

export type WebPushPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export type UseWebPushResult = {
  /** El navegador soporta Notification + serviceWorker + PushManager. */
  isSupported: boolean
  /** Estado del permiso actual o 'unsupported'. */
  permission: WebPushPermission
  /** Hay una suscripción activa en este browser para este user. */
  isSubscribed: boolean
  /** Loading flag para botones (mientras se hace subscribe/unsubscribe). */
  busy: boolean
  /** Pide permiso al usuario (Notification.requestPermission). */
  requestPermission: () => Promise<WebPushPermission>
  /** Suscribe via PushManager + persiste server-side. */
  subscribe: () => Promise<void>
  /** Borra suscripción local + server. */
  unsubscribe: () => Promise<void>
}

/**
 * Convierte una VAPID public key (base64url) a Uint8Array — formato
 * que `pushManager.subscribe` espera en `applicationServerKey`.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  // En jsdom puede que `atob` esté ausente: lo tipamos defensivo.
  const raw =
    typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('binary')
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

function detectSupport(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

function readPermission(): WebPushPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return Notification.permission as WebPushPermission
}

async function readyServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

function subscriptionToInput(sub: PushSubscription, userAgent: string | null) {
  const json = sub.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  if (
    !json.endpoint ||
    !json.keys?.p256dh ||
    !json.keys?.auth
  ) {
    throw new Error('[INVALID_INPUT] PushSubscription sin endpoint o keys')
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent,
  }
}

export function useWebPush(userId?: string | null): UseWebPushResult {
  const [isSupported, setIsSupported] = useState<boolean>(false)
  const [permission, setPermission] = useState<WebPushPermission>('unsupported')
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)

  // Detección de soporte y carga inicial del estado.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const supported = detectSupport()
    setIsSupported(supported)
    setPermission(readPermission())
    if (!supported) return

    let cancelled = false
    void (async () => {
      const reg = await readyServiceWorker()
      if (cancelled) return
      if (!reg) {
        setIsSubscribed(false)
        return
      }
      try {
        const existing = await reg.pushManager.getSubscription()
        if (!cancelled) setIsSubscribed(!!existing)
      } catch {
        if (!cancelled) setIsSubscribed(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const requestPermission = useCallback(async (): Promise<WebPushPermission> => {
    if (!isSupported) return 'unsupported'
    try {
      const result = await Notification.requestPermission()
      setPermission(result as WebPushPermission)
      return result as WebPushPermission
    } catch (err) {
      console.error('[useWebPush] requestPermission', err)
      return 'denied'
    }
  }, [isSupported])

  const subscribe = useCallback(async () => {
    if (!isSupported) throw new Error('[UNSUPPORTED] Web Push no soportado')
    setBusy(true)
    try {
      let perm = permission
      if (perm === 'default' || perm === 'unsupported') {
        perm = await requestPermission()
      }
      if (perm !== 'granted') {
        throw new Error('[PERMISSION_DENIED] El usuario rechazó el permiso')
      }

      const reg = await readyServiceWorker()
      if (!reg) throw new Error('[NO_SW] Service Worker no disponible')

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
      if (!vapidKey) {
        throw new Error(
          '[NO_VAPID] Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY (configurar VAPID keys)',
        )
      }

      const existing = await reg.pushManager.getSubscription()
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // `applicationServerKey` espera BufferSource. Pasamos el `.buffer`
          // tipado a ArrayBuffer para evitar que TS infiera SharedArrayBuffer.
          applicationServerKey: urlBase64ToUint8Array(vapidKey)
            .buffer as ArrayBuffer,
        }))

      const ua =
        typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
          ? navigator.userAgent
          : null

      await subscribeToPush({
        ...subscriptionToInput(sub, ua),
        userId: userId ?? null,
      })

      setIsSubscribed(true)
    } finally {
      setBusy(false)
    }
  }, [isSupported, permission, requestPermission, userId])

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return
    setBusy(true)
    try {
      const reg = await readyServiceWorker()
      if (!reg) {
        setIsSubscribed(false)
        return
      }
      const existing = await reg.pushManager.getSubscription()
      if (existing) {
        const endpoint = existing.endpoint
        try {
          await existing.unsubscribe()
        } catch (err) {
          console.error('[useWebPush] unsubscribe local', err)
        }
        try {
          await unsubscribeFromPush({ endpoint, userId: userId ?? null })
        } catch (err) {
          console.error('[useWebPush] unsubscribeFromPush server', err)
        }
      }
      setIsSubscribed(false)
    } finally {
      setBusy(false)
    }
  }, [isSupported, userId])

  return useMemo(
    () => ({
      isSupported,
      permission,
      isSubscribed,
      busy,
      requestPermission,
      subscribe,
      unsubscribe,
    }),
    [
      isSupported,
      permission,
      isSubscribed,
      busy,
      requestPermission,
      subscribe,
      unsubscribe,
    ],
  )
}
