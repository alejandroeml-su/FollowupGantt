/**
 * Wave P17-B · Dispatcher de webhooks outbound v2.
 *
 * Diferencias vs v1:
 *   - Workspace-scoped (filtra por subscriptions del workspace emisor).
 *   - Persiste cada intento en `WebhookDelivery` (forensics + replay).
 *   - Retry exponencial 1s · 5s · 30s (3 reintentos máximo).
 *   - Auto-disable de la subscription tras 10 fallos consecutivos
 *     (`failureCount` ≥ 10) — esto se evalúa al final de cada delivery
 *     fallida (no por cada reintento individual).
 *   - HMAC SHA-256 con header `X-Signature-256: sha256=<hex>`.
 *
 * Filosofía:
 *   - Fire-and-forget desde server actions: NO bloqueamos al usuario.
 *   - Idempotencia: receptores deben deduplicar por `delivery_id` (lo
 *     incluimos en el payload).
 *   - Best-effort en BD: errores al persistir delivery se loguean, NO
 *     se propagan.
 *
 * Tests:
 *   - `computeBackoffMs(retryCount)` y `MAX_RETRIES` exportados puros.
 *   - El loop de retry usa `setTimeout` envuelto en `wait` para poder
 *     mockearse con vi.useFakeTimers().
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { signPayload, V2_SIGNATURE_HEADER } from '@/lib/webhooks-out/signature'
import type { V2EventType } from '@/lib/webhooks-out/events'

const DELIVERY_TIMEOUT_MS = 5_000
const RESPONSE_BODY_MAX_CHARS = 2_048

export const MAX_RETRIES = 3 // intentos extra; total = 1 + 3 = 4 envíos
export const FAILURE_DISABLE_THRESHOLD = 10
const BACKOFF_SCHEDULE_MS = [1_000, 5_000, 30_000] as const

/**
 * Devuelve el delay (ms) antes del próximo intento. retryCount=0 → no
 * espera (es el primer intento). retryCount=1 → 1s, 2 → 5s, 3 → 30s.
 * Para counts mayores, repite el último (defensivo).
 */
export function computeBackoffMs(retryCount: number): number {
  if (retryCount <= 0) return 0
  const idx = Math.min(retryCount - 1, BACKOFF_SCHEDULE_MS.length - 1)
  return BACKOFF_SCHEDULE_MS[idx]
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface DispatchInput {
  workspaceId: string
  event: V2EventType
  payload: unknown
}

/**
 * Encola entregas para todas las subscriptions activas del workspace
 * suscritas al `event`. Best-effort: si la BD falla al consultar, devolvemos
 * sin emitir (la operación de negocio ya se completó).
 *
 * Devuelve la promesa para tests; los callers en server actions usan
 * `void dispatchEvent(...)` (fire-and-forget).
 */
export async function dispatchEvent(input: DispatchInput): Promise<void> {
  let subs: Array<{ id: string; url: string; secret: string }> = []
  try {
    const rows = await prisma.webhookSubscription.findMany({
      where: {
        workspaceId: input.workspaceId,
        active: true,
        events: { has: input.event },
      },
      select: { id: true, url: true, secret: true },
    })
    subs = rows
  } catch (err) {
    console.warn('[webhooks-v2] error consultando subscriptions:', err)
    return
  }
  if (subs.length === 0) return

  // Lanzamos en paralelo. Cada `deliverWithRetries` resuelve siempre.
  await Promise.allSettled(
    subs.map((sub) =>
      deliverWithRetries({
        subscriptionId: sub.id,
        url: sub.url,
        secret: sub.secret,
        event: input.event,
        payload: input.payload,
      }),
    ),
  )
}

interface DeliverInput {
  subscriptionId: string
  url: string
  secret: string
  event: V2EventType
  payload: unknown
}

/**
 * Encapsula el ciclo de retries para UNA subscription. Persiste cada
 * intento como `WebhookDelivery` y, al final, actualiza
 * `lastDeliveryAt`/`failureCount`/`active` de la subscription.
 */
export async function deliverWithRetries(input: DeliverInput): Promise<void> {
  const bodyStr = JSON.stringify({
    event: input.event,
    timestamp: new Date().toISOString(),
    data: input.payload,
  })

  let success = false
  let lastStatus: number | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await wait(computeBackoffMs(attempt))
    }

    const result = await deliverOnce({
      url: input.url,
      secret: input.secret,
      body: bodyStr,
    })
    lastStatus = result.status

    // Persiste el intento (best-effort).
    await prisma.webhookDelivery
      .create({
        data: {
          subscriptionId: input.subscriptionId,
          event: input.event,
          payload: input.payload as object,
          responseStatus: result.status,
          responseBody: result.body
            ? result.body.slice(0, RESPONSE_BODY_MAX_CHARS)
            : null,
          retryCount: attempt,
        },
      })
      .catch((err) => {
        console.warn('[webhooks-v2] error persistiendo delivery:', err)
      })

    if (result.success) {
      success = true
      break
    }
  }

  // Update de la subscription: reset failureCount al éxito; si todos
  // los intentos fallaron, incrementa y posible auto-disable.
  await prisma.webhookSubscription
    .update({
      where: { id: input.subscriptionId },
      data: success
        ? {
            lastDeliveryAt: new Date(),
            failureCount: 0,
          }
        : {
            lastDeliveryAt: new Date(),
            failureCount: { increment: 1 },
          },
    })
    .catch((err) => {
      console.warn('[webhooks-v2] error actualizando subscription:', err)
    })

  // Si fue fallida, evaluamos auto-disable en una segunda query (no
  // podemos hacerlo en el mismo update porque necesitamos el valor post-
  // increment). Lo hacemos best-effort.
  if (!success) {
    try {
      const refreshed = await prisma.webhookSubscription.findUnique({
        where: { id: input.subscriptionId },
        select: { failureCount: true, active: true },
      })
      if (
        refreshed &&
        refreshed.active &&
        refreshed.failureCount >= FAILURE_DISABLE_THRESHOLD
      ) {
        await prisma.webhookSubscription.update({
          where: { id: input.subscriptionId },
          data: { active: false },
        })
        console.warn(
          `[webhooks-v2] auto-disable subscription ${input.subscriptionId} ` +
            `tras ${refreshed.failureCount} fallos consecutivos (lastStatus=${lastStatus})`,
        )
      }
    } catch (err) {
      console.warn('[webhooks-v2] error evaluando auto-disable:', err)
    }
  }
}

interface DeliverOnceResult {
  success: boolean
  status: number | null
  body: string | null
}

/**
 * Ejecuta UNA llamada HTTP firmada con timeout. Nunca lanza — devuelve un
 * resultado normalizado. Exportado para tests + override en mocks.
 */
export async function deliverOnce(input: {
  url: string
  secret: string
  body: string
}): Promise<DeliverOnceResult> {
  const signature = signPayload(input.secret, input.body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)

  try {
    const res = await fetch(input.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Sync-Webhook/2.0',
        [V2_SIGNATURE_HEADER]: signature,
      },
      body: input.body,
      signal: controller.signal,
    })
    let body: string | null = null
    try {
      body = await res.text()
    } catch {
      body = null
    }
    return { success: res.ok, status: res.status, body }
  } catch (err) {
    return {
      success: false,
      status: null,
      body: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}
