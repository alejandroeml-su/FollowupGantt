/**
 * Webhooks outbound (Ola P4 · Equipo P4-2) — dispatcher de eventos.
 *
 * Filosofía:
 *   - Best-effort, fire-and-forget. Las server actions del repo invocan
 *     `dispatchWebhookEvent(eventType, payload)` SIN esperar resultado:
 *     un webhook caído no debe romper la operación interna. Errores de red
 *     y respuestas non-2xx incrementan `failureCount` en BD para que el
 *     usuario los vea en `/settings/webhooks`.
 *   - Concurrencia: cuando un evento dispara N webhooks, los lanzamos en
 *     paralelo con `Promise.allSettled` para no bloquear unos con otros.
 *   - Timeout duro de 5s por delivery (`AbortController`). Sin reintentos
 *     automáticos en P4 (el usuario reintenta manualmente desde la UI o
 *     una iteración futura introduce backoff con cola Redis).
 *
 * Catálogo de eventTypes canónicos:
 *   - `task.created`, `task.updated`, `task.deleted`
 *   - `project.created`, `project.updated`, `project.deleted`
 *   - `dependency.created`, `dependency.deleted`
 *   - `baseline.captured`
 *
 * NOTA: el dispatcher se importa desde server actions (que ya son
 * `'use server'`). NO marcar este archivo con `'use server'` porque las
 * funciones internas (firma, fetch) no son acciones de formulario.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { signPayload, SIGNATURE_HEADER } from '@/lib/webhooks/signature'

export type WebhookEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'dependency.created'
  | 'dependency.deleted'
  | 'baseline.captured'

export const KNOWN_EVENTS: readonly WebhookEventType[] = [
  'task.created',
  'task.updated',
  'task.deleted',
  'project.created',
  'project.updated',
  'project.deleted',
  'dependency.created',
  'dependency.deleted',
  'baseline.captured',
]

const DELIVERY_TIMEOUT_MS = 5_000

/**
 * Estructura del body que se firma y envía. Incluye `event`, `timestamp` y
 * `data` para que el receptor pueda discriminar y reconstruir contexto.
 */
export interface WebhookPayload {
  event: WebhookEventType
  timestamp: string // ISO 8601
  data: unknown
}

/**
 * Despacha un evento a TODOS los webhooks activos suscritos. Idempotente
 * por el lado del emisor — si la misma operación llama dos veces, se hacen
 * dos deliveries.
 *
 * No-throw: errores de red, timeouts, 5xx no bloquean al caller. Los logs
 * van a `console.warn` para que sean visibles en Vercel logs.
 */
export async function dispatchWebhookEvent(
  eventType: WebhookEventType,
  data: unknown,
): Promise<void> {
  const subscribers = await getSubscribedWebhooks(eventType)
  if (subscribers.length === 0) return

  const payload: WebhookPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data,
  }
  const body = JSON.stringify(payload)

  // Lanzamos todos en paralelo. allSettled no rechaza nunca → safe.
  await Promise.allSettled(
    subscribers.map((hook) => deliverWebhook(hook, body)),
  )
}

/**
 * Lee de BD los webhooks que (1) están activos y (2) tienen el eventType
 * suscrito en su array `events` (o el wildcard `*`).
 *
 * El filtro de `events` se hace en memoria porque es JSON; con N webhooks
 * activos chico (esperamos <50) es trivial. Si crece, mover a JSONB
 * containment query (`events @> '["task.created"]'`).
 */
async function getSubscribedWebhooks(
  eventType: WebhookEventType,
): Promise<Array<{ id: string; url: string; secret: string }>> {
  try {
    const rows = await prisma.webhook.findMany({
      where: { active: true },
      select: { id: true, url: true, secret: true, events: true },
    })
    return rows
      .filter((row) => {
        if (!Array.isArray(row.events)) return false
        const list = row.events as string[]
        return list.includes(eventType) || list.includes('*')
      })
      .map(({ id, url, secret }) => ({ id, url, secret }))
  } catch (err) {
    // BD caída no debe ahogar al caller — log y devolver vacío.
    console.warn('[webhooks] error consultando suscriptores:', err)
    return []
  }
}

/**
 * Ejecuta un POST individual con timeout y firma HMAC. Actualiza
 * `lastDeliveryAt`/`lastDeliveryStatus`/`failureCount` best-effort.
 */
async function deliverWebhook(
  hook: { id: string; url: string; secret: string },
  body: string,
): Promise<void> {
  const signature = signPayload(hook.secret, body)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)

  let status = 0
  let success = false
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FollowupGantt-Webhook/1.0',
        [SIGNATURE_HEADER]: signature,
      },
      body,
      signal: controller.signal,
    })
    status = res.status
    success = res.ok
  } catch (err) {
    console.warn(`[webhooks] delivery a ${hook.url} falló:`, err)
  } finally {
    clearTimeout(timer)
  }

  // Actualiza estadísticas best-effort. Silenciamos errores.
  await prisma.webhook
    .update({
      where: { id: hook.id },
      data: {
        lastDeliveryAt: new Date(),
        lastDeliveryStatus: status || null,
        ...(success ? { failureCount: 0 } : { failureCount: { increment: 1 } }),
      },
    })
    .catch(() => {})
}
