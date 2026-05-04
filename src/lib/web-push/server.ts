/**
 * Wave P6 · Equipo A4 — Helper server para Web Push API.
 *
 * Wrapper sobre `web-push` (npm) que:
 *   1. Carga VAPID keys desde env y configura `setVapidDetails` una vez.
 *   2. Lee suscripciones del usuario desde Prisma y dispara push con
 *      `webpush.sendNotification` (HTTP POST cifrado al endpoint del
 *      navegador FCM/Mozilla/Apple).
 *   3. Limpia suscripciones expiradas (HTTP 404/410) automáticamente.
 *
 * No usa `Promise.all` para los envíos: usa `Promise.allSettled` para que
 * un endpoint caído no aborte los demás (cada usuario puede tener N
 * dispositivos suscritos). Si falla la lectura de VAPID keys, el helper
 * no lanza — devuelve `{ sent: 0, failed: 0, skipped: 'no-vapid' }` para
 * que las server actions que lo invocan como side-effect no rompan flujo.
 *
 * Convenciones:
 *   - Errores tipados con prefijo `[CODE] detalle`.
 *   - Strings ES.
 */

import 'server-only'
import webpush from 'web-push'
import prisma from '@/lib/prisma'

export type WebPushErrorCode =
  | 'NO_VAPID'
  | 'INVALID_INPUT'
  | 'SUBSCRIPTION_GONE'
  | 'SEND_FAILED'

function actionError(code: WebPushErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

export type WebPushPayload = {
  title: string
  body?: string
  url?: string
  /** Metadata libre (opaca para el SW; útil para clients ricos). */
  data?: Record<string, unknown>
}

export type SendPushResult = {
  sent: number
  failed: number
  skipped?: 'no-vapid' | 'no-subscriptions'
  /** Endpoints eliminados por respuesta 404/410 del push service. */
  removed: string[]
}

let vapidConfigured = false

/**
 * Configura `setVapidDetails` una sola vez. Si las env vars no están
 * presentes, marca el módulo como no operacional y todos los `sendPush*`
 * devuelven `skipped: 'no-vapid'` sin lanzar — esto permite que entornos
 * dev/preview sin VAPID generadas no rompan flujos que invocan push como
 * side-effect.
 */
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
    // Claves mal formateadas: dejamos `vapidConfigured = false` y que
    // el caller lo trate como skipped. No spammeamos logs en cada call.
    console.error('[web-push] setVapidDetails falló', err)
    return false
  }
}

/**
 * Solo para tests: resetea el flag `vapidConfigured` para que el siguiente
 * `ensureVapidConfigured` lea env vars de nuevo. No usar en producción.
 */
export function __resetVapidForTests(): void {
  vapidConfigured = false
}

type SubscriptionRow = {
  id: string
  endpoint: string
  keys: unknown
}

function isExpiredStatus(statusCode: number | undefined): boolean {
  // RFC 8030: 404 (endpoint nunca existió) y 410 (Gone) → eliminar.
  return statusCode === 404 || statusCode === 410
}

function toPushSubscription(row: SubscriptionRow): {
  endpoint: string
  keys: { p256dh: string; auth: string }
} {
  const keys = row.keys as { p256dh?: string; auth?: string } | null
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    actionError('INVALID_INPUT', `Suscripción ${row.id} sin keys válidas`)
  }
  return {
    endpoint: row.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  }
}

/**
 * Envía un push a TODAS las suscripciones de un usuario. Limpia
 * suscripciones que respondan 404/410. Idempotente respecto a Prisma
 * (no modifica `Notification`, solo `PushSubscription`).
 */
export async function sendPushToUser(
  userId: string,
  payload: WebPushPayload,
): Promise<SendPushResult> {
  if (!userId) actionError('INVALID_INPUT', 'userId requerido')
  if (!payload?.title) actionError('INVALID_INPUT', 'payload.title requerido')

  if (!ensureVapidConfigured()) {
    return { sent: 0, failed: 0, skipped: 'no-vapid', removed: [] }
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, keys: true },
  })

  if (subs.length === 0) {
    return { sent: 0, failed: 0, skipped: 'no-subscriptions', removed: [] }
  }

  const json = JSON.stringify(payload)
  const removed: string[] = []
  let sent = 0
  let failed = 0

  const results = await Promise.allSettled(
    subs.map(async (s) => {
      const sub = toPushSubscription(s)
      try {
        await webpush.sendNotification(sub, json)
        return { ok: true as const, id: s.id }
      } catch (err) {
        const e = err as { statusCode?: number; body?: string }
        if (isExpiredStatus(e?.statusCode)) {
          return { ok: false as const, id: s.id, gone: true }
        }
        return { ok: false as const, id: s.id, gone: false }
      }
    }),
  )

  const goneIds: string[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value.ok) {
        sent++
      } else {
        failed++
        if (r.value.gone) goneIds.push(r.value.id)
      }
    } else {
      failed++
    }
  }

  // Limpieza de suscripciones expiradas en una sola query.
  if (goneIds.length > 0) {
    const goneSubs = subs.filter((s) => goneIds.includes(s.id))
    removed.push(...goneSubs.map((s) => s.endpoint))
    await prisma.pushSubscription.deleteMany({ where: { id: { in: goneIds } } })
  }

  // Marcamos lastUsedAt en las que sí funcionaron (mejor effort).
  if (sent > 0) {
    const okIds = results
      .filter(
        (r): r is PromiseFulfilledResult<{ ok: true; id: string }> =>
          r.status === 'fulfilled' && r.value.ok,
      )
      .map((r) => r.value.id)
    await prisma.pushSubscription.updateMany({
      where: { id: { in: okIds } },
      data: { lastUsedAt: new Date() },
    })
  }

  return { sent, failed, removed }
}

/**
 * Bulk: envía push a varios usuarios en paralelo (cada uno con su set
 * de suscripciones). Devuelve totales agregados.
 */
export async function sendPushToMany(
  userIds: string[],
  payload: WebPushPayload,
): Promise<SendPushResult> {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { sent: 0, failed: 0, skipped: 'no-subscriptions', removed: [] }
  }

  const unique = Array.from(new Set(userIds.filter((u) => typeof u === 'string' && u.length > 0)))
  if (unique.length === 0) {
    return { sent: 0, failed: 0, skipped: 'no-subscriptions', removed: [] }
  }

  if (!ensureVapidConfigured()) {
    return { sent: 0, failed: 0, skipped: 'no-vapid', removed: [] }
  }

  const results = await Promise.allSettled(
    unique.map((uid) => sendPushToUser(uid, payload)),
  )

  let sent = 0
  let failed = 0
  const removed: string[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      sent += r.value.sent
      failed += r.value.failed
      if (r.value.removed) removed.push(...r.value.removed)
    } else {
      failed++
    }
  }

  return { sent, failed, removed }
}

/**
 * Expone la public key para el cliente (solo lectura, no secret).
 * Equivalente a leer `NEXT_PUBLIC_VAPID_PUBLIC_KEY` desde el bundle —
 * útil para validaciones server-side.
 */
export function getPublicVapidKey(): string {
  return (
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
    process.env.VAPID_PUBLIC_KEY ??
    ''
  )
}
