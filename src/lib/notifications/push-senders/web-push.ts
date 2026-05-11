/**
 * Wave R4-B · Adapter Web Push (VAPID) — refactor del helper P6.
 *
 * Mantiene `web-push` (npm) como dependencia subyacente. Lee VAPID keys
 * desde env vars (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `WEB_PUSH_SUBJECT`)
 * y expone la interfaz `PushAdapter` para el dispatcher.
 *
 * Diferencias vs `src/lib/web-push/server.ts` (legacy):
 *   - Este adapter NO toca Prisma: solo envía y devuelve resultado.
 *   - El dispatcher es quien borra rows `gone` y actualiza `lastUsedAt`.
 *   - Errores tipados se interpretan: 404/410 → `gone: true` (cleanup).
 *
 * Convenciones:
 *   - 'use server' purity: este módulo es server-only puro.
 *   - Errores nunca propagan: siempre `AdapterSendResult`.
 */

import 'server-only'
import webpush from 'web-push'
import type {
  AdapterSendResult,
  PushAdapter,
  PushPayload,
  PushSubscriptionRow,
} from './types'

let vapidConfigured = false

function isExpiredStatus(statusCode: number | undefined): boolean {
  // RFC 8030: 404 (endpoint nunca existió) y 410 (Gone) → eliminar.
  return statusCode === 404 || statusCode === 410
}

export function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true

  const publicKey = process.env.VAPID_PUBLIC_KEY ?? ''
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? ''
  const subject =
    process.env.WEB_PUSH_SUBJECT ?? 'mailto:notifications@complejoavante.com'

  if (!publicKey || !privateKey) return false

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    vapidConfigured = true
    return true
  } catch (err) {
    console.error('[push-senders/web-push] setVapidDetails falló', err)
    return false
  }
}

/** Solo para tests: limpia el flag cacheado. */
export function __resetWebPushForTests(): void {
  vapidConfigured = false
}

export const webPushAdapter: PushAdapter = {
  kind: 'WEB_PUSH',

  isConfigured(): boolean {
    return ensureVapidConfigured()
  },

  async send(
    sub: PushSubscriptionRow,
    payload: PushPayload,
  ): Promise<AdapterSendResult> {
    if (!ensureVapidConfigured()) {
      return { delivered: false, skipped: true, error: 'no-vapid' }
    }

    const keys = sub.keys
    if (
      !keys ||
      typeof keys.p256dh !== 'string' ||
      typeof keys.auth !== 'string'
    ) {
      return {
        delivered: false,
        gone: true,
        error: 'INVALID_KEYS',
      }
    }

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        },
        JSON.stringify(payload),
      )
      return { delivered: true }
    } catch (err) {
      const e = err as { statusCode?: number; body?: string }
      const gone = isExpiredStatus(e?.statusCode)
      return {
        delivered: false,
        gone,
        error: `web-push status=${e?.statusCode ?? 'unknown'}`,
      }
    }
  },
}

export function getPublicVapidKey(): string {
  return (
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
    process.env.VAPID_PUBLIC_KEY ??
    ''
  )
}
