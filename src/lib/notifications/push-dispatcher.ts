/**
 * Wave R4-B · Dispatcher dual web + native.
 *
 * Carga todas las suscripciones de un usuario y rutea cada una a su
 * adapter (`web-push` / `apns` / `fcm`) según `PushSubscription.kind`.
 * Limpia tokens `gone` (404/410/Unregistered/BadDeviceToken) en una
 * sola query batched.
 *
 * Backward-compat:
 *   - Rows existentes (`kind = WEB_PUSH` por DEFAULT) se procesan
 *     idénticamente al pipeline P6, vía `webPushAdapter`.
 *   - APNs/FCM se silencian (`skipped`) si las env vars no están
 *     configuradas → entornos dev/preview no rompen flujos que invocan
 *     push como side-effect.
 *
 * Garantías:
 *   - Nunca lanza: errores por sub se contabilizan en `failed` por kind.
 *   - `Promise.allSettled` para que un endpoint caído no aborte los demás.
 *   - Update `lastUsedAt` solo en envíos exitosos (best-effort).
 *
 * Convenciones:
 *   - 'use server' purity.
 *   - Errores tipados con prefijo `[CODE] detalle` (solo INVALID_INPUT).
 */

import 'server-only'
import type { PushSubscriptionKind } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  apnsAdapter,
  fcmAdapter,
  webPushAdapter,
  type AdapterSendResult,
  type PushAdapter,
  type PushPayload,
  type PushSubscriptionRow,
} from './push-senders'

export type DispatchKindResult = {
  sent: number
  failed: number
  skipped: number
  removed: number
}

export type DispatchPushResult = {
  WEB_PUSH: DispatchKindResult
  APNS: DispatchKindResult
  FCM: DispatchKindResult
  /** Totales agregados (suma de los 3 kinds). */
  total: { sent: number; failed: number; skipped: number; removed: number }
}

function emptyKindResult(): DispatchKindResult {
  return { sent: 0, failed: 0, skipped: 0, removed: 0 }
}

function emptyResult(): DispatchPushResult {
  return {
    WEB_PUSH: emptyKindResult(),
    APNS: emptyKindResult(),
    FCM: emptyKindResult(),
    total: { sent: 0, failed: 0, skipped: 0, removed: 0 },
  }
}

/**
 * Adapter map inyectable — exportado para tests que necesitan stubear
 * un adapter sin tocar process.env ni el módulo real.
 */
export const adaptersByKind: Record<PushSubscriptionKind, PushAdapter> = {
  WEB_PUSH: webPushAdapter,
  APNS: apnsAdapter,
  FCM: fcmAdapter,
}

type LoadedSubscription = PushSubscriptionRow

function rowToSubscription(row: {
  id: string
  userId: string
  endpoint: string
  keys: unknown
  kind: PushSubscriptionKind
}): LoadedSubscription {
  const keys =
    row.keys && typeof row.keys === 'object'
      ? (row.keys as { p256dh?: string; auth?: string })
      : null
  return {
    id: row.id,
    userId: row.userId,
    endpoint: row.endpoint,
    keys,
    kind: row.kind,
  }
}

/**
 * Envía un push a TODAS las suscripciones del usuario, routeando por
 * `kind`. Si un adapter no está configurado, sus subs se cuentan como
 * `skipped` (no errores).
 */
export async function dispatchPush(
  userId: string,
  payload: PushPayload,
  options?: {
    /** Override del map (testing). */
    adapters?: Record<PushSubscriptionKind, PushAdapter>
    /** Prisma client override (testing). */
    prismaClient?: typeof prisma
  },
): Promise<DispatchPushResult> {
  if (!userId || typeof userId !== 'string') {
    throw new Error('[INVALID_INPUT] userId requerido')
  }
  if (!payload || typeof payload.title !== 'string' || payload.title.length === 0) {
    throw new Error('[INVALID_INPUT] payload.title requerido')
  }

  const db = options?.prismaClient ?? prisma
  const adapters = options?.adapters ?? adaptersByKind

  const rows = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, userId: true, endpoint: true, keys: true, kind: true },
  })

  const result = emptyResult()
  if (rows.length === 0) return result

  const subs = rows.map(rowToSubscription)

  // Dispara en paralelo TODOS los envíos; cada adapter se autoescudará
  // si no tiene credenciales (`skipped: true`).
  const settled = await Promise.allSettled(
    subs.map(async (sub) => {
      const adapter = adapters[sub.kind]
      if (!adapter) {
        const outcome: AdapterSendResult = {
          delivered: false,
          error: `unknown-kind: ${sub.kind}`,
        }
        return { sub, outcome }
      }
      const outcome = await adapter.send(sub, payload)
      return { sub, outcome }
    }),
  )

  const goneIds: string[] = []
  const sentIds: string[] = []

  for (const item of settled) {
    if (item.status === 'rejected') {
      // No debería pasar — los adapters nunca lanzan — pero defendemos.
      result.WEB_PUSH.failed++ // sin info de kind, asignar al default
      continue
    }
    const { sub, outcome } = item.value
    const bucket = result[sub.kind]
    if (outcome.skipped) {
      bucket.skipped++
      // Log defensivo solo si la env var deshabilitadora no está set.
      if (sub.kind !== 'WEB_PUSH') {
        console.warn(
          `[push-dispatcher] adapter ${sub.kind} not configured — skipped sub ${sub.id}`,
        )
      }
      continue
    }
    if (outcome.delivered) {
      bucket.sent++
      sentIds.push(sub.id)
      continue
    }
    bucket.failed++
    if (outcome.gone) {
      goneIds.push(sub.id)
      bucket.removed++
    }
  }

  // Cleanup tokens muertos en batch.
  if (goneIds.length > 0) {
    try {
      await db.pushSubscription.deleteMany({ where: { id: { in: goneIds } } })
    } catch (err) {
      console.warn('[push-dispatcher] cleanup gone tokens failed', err)
    }
  }

  // Update lastUsedAt en envíos OK (best-effort).
  if (sentIds.length > 0) {
    try {
      await db.pushSubscription.updateMany({
        where: { id: { in: sentIds } },
        data: { lastUsedAt: new Date() },
      })
    } catch (err) {
      console.warn('[push-dispatcher] updateMany lastUsedAt failed', err)
    }
  }

  // Totales agregados.
  for (const kind of ['WEB_PUSH', 'APNS', 'FCM'] as PushSubscriptionKind[]) {
    result.total.sent += result[kind].sent
    result.total.failed += result[kind].failed
    result.total.skipped += result[kind].skipped
    result.total.removed += result[kind].removed
  }

  return result
}

/**
 * Bulk: envía push a varios usuarios en paralelo. Mantiene la firma
 * histórica `sendPushToMany`-like para integraciones existentes.
 */
export async function dispatchPushToMany(
  userIds: string[],
  payload: PushPayload,
): Promise<DispatchPushResult> {
  if (!Array.isArray(userIds) || userIds.length === 0) return emptyResult()

  const unique = Array.from(
    new Set(userIds.filter((u) => typeof u === 'string' && u.length > 0)),
  )
  if (unique.length === 0) return emptyResult()

  const settled = await Promise.allSettled(
    unique.map((uid) => dispatchPush(uid, payload)),
  )

  const result = emptyResult()
  for (const s of settled) {
    if (s.status !== 'fulfilled') {
      result.total.failed++
      continue
    }
    for (const kind of ['WEB_PUSH', 'APNS', 'FCM'] as PushSubscriptionKind[]) {
      result[kind].sent += s.value[kind].sent
      result[kind].failed += s.value[kind].failed
      result[kind].skipped += s.value[kind].skipped
      result[kind].removed += s.value[kind].removed
    }
    result.total.sent += s.value.total.sent
    result.total.failed += s.value.total.failed
    result.total.skipped += s.value.total.skipped
    result.total.removed += s.value.total.removed
  }
  return result
}
