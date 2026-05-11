/**
 * R3-E · Audit Streaming · Engine de batching.
 *
 * Responsabilidades:
 *   - `enqueueEvent(workspaceId, event)`: encola en una cola in-memory por
 *     workspace. NUNCA bloquea ni lanza — si la cola está llena (DEFAULT
 *     CAP=10_000 por workspace) el evento se descarta con `console.warn`.
 *   - `flushBatches({ now, fetchImpl })`: agrupa cola → targets enabled del
 *     workspace, llama al adapter en paralelo con retry exponencial
 *     (1s, 5s, 30s) y persiste `AuditStreamDelivery`.
 *   - `retryFailedDeliveries({ now, fetchImpl })`: reintenta deliveries
 *     `FAILED` o `RETRYING` con attempt < MAX_ATTEMPTS. NO reencola
 *     los eventos originales (ya fueron descargados de la cola); el
 *     reintento sólo reenvía si el caller tiene un payload de respaldo.
 *     En MVP el cron retry pasa por `flushBatches` (no por re-delivery
 *     de eventos antiguos — quedan en `AuditEvent` como source-of-truth).
 *
 * Trade-off (D-R3E-1): cola in-memory vs Redis/DB. Elegimos in-memory
 * porque:
 *   - `AuditEvent` ya es source-of-truth: si el proceso muere antes del
 *     flush, los eventos siguen en BD y se pueden reenviar manualmente.
 *   - Reduce dependencia infra (Redis) en MVP. Si la presión sube
 *     (>1k events/s sostenido), R4 introducirá Redis Streams.
 *   - Vercel serverless: la cola vive por instancia, pero el cron de
 *     `flushBatches` corre cada 5 min y "vacía" lo que esté presente.
 *     Sí, eventos producidos por una instancia y aún no flushed cuando
 *     muere la instancia se pierden del SIEM (no de BD). Aceptable en
 *     MVP por el SLO de "best-effort streaming".
 */

import { randomUUID } from 'node:crypto'

import prisma from '@/lib/prisma'
import type { AuditStreamKind } from '@prisma/client'

import type {
  Adapter,
  StreamableEvent,
  StreamTargetSnapshot,
} from './types'
import { getAdapter } from './adapters'

// ────────────────────────── Configuración ──────────────────────────

export const MAX_QUEUE_SIZE_PER_WORKSPACE = 10_000
export const MAX_ATTEMPTS = 3
export const DEFAULT_BATCH_SIZE = 100

/** Delays en ms entre reintentos (índice = attempt anterior). */
export const RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const

// ────────────────────────── Estado in-memory ──────────────────────────

type WorkspaceQueue = StreamableEvent[]

const queues = new Map<string, WorkspaceQueue>()

/** Solo para tests / shutdown — vacía la cola sin enviar. */
export function __resetQueueForTests(): void {
  queues.clear()
}

/** Útil para inspección en tests. */
export function __queueSizeForTests(workspaceId: string): number {
  return queues.get(workspaceId)?.length ?? 0
}

// ────────────────────────── API pública ──────────────────────────

/**
 * Encola un evento para streaming. Nunca bloquea ni lanza. Si la cola
 * del workspace está llena, descarta el evento más reciente con un
 * `console.warn` y deja la cola intacta (FIFO preservado).
 */
export function enqueueEvent(
  workspaceId: string | null,
  event: StreamableEvent,
): void {
  if (!workspaceId) {
    // Eventos sin workspace no pueden ser dirigidos a un target —
    // simplemente se descartan del streaming. Siguen en `AuditEvent`.
    return
  }
  let q = queues.get(workspaceId)
  if (!q) {
    q = []
    queues.set(workspaceId, q)
  }
  if (q.length >= MAX_QUEUE_SIZE_PER_WORKSPACE) {
    console.warn(
      `[AuditStreaming] cola llena para workspace=${workspaceId} — drop event ${event.id}`,
    )
    return
  }
  q.push(event)
}

// ────────────────────────── Flush ──────────────────────────

export type FlushOptions = {
  /** Inyectable para tests. Default: `fetch` global. */
  fetchImpl?: typeof fetch
  /** Inyectable para tests deterministas. Default: `Date.now()`. */
  now?: () => Date
  /** Si true, no espera entre intentos (tests). Default false. */
  noWait?: boolean
}

export type FlushSummary = {
  targetsProcessed: number
  batchesSent: number
  eventsSent: number
  batchesFailed: number
}

/**
 * Vacía las colas in-memory por workspace, agrupa por target enabled y
 * despacha en paralelo (Promise.all). Persiste un `AuditStreamDelivery`
 * por batch con el resultado final.
 */
export async function flushBatches(
  opts: FlushOptions = {},
): Promise<FlushSummary> {
  const now = opts.now ?? (() => new Date())

  const workspaceIds = Array.from(queues.keys())
  if (workspaceIds.length === 0) {
    return { targetsProcessed: 0, batchesSent: 0, eventsSent: 0, batchesFailed: 0 }
  }

  const targets = await prisma.auditStreamTarget.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      enabled: true,
    },
  })

  let batchesSent = 0
  let eventsSent = 0
  let batchesFailed = 0

  await Promise.all(
    targets.map(async (target) => {
      const queue = queues.get(target.workspaceId)
      if (!queue || queue.length === 0) return

      const events = queue.splice(0, queue.length)
      const batchSize = target.batchSize > 0 ? target.batchSize : DEFAULT_BATCH_SIZE

      for (let i = 0; i < events.length; i += batchSize) {
        const slice = events.slice(i, i + batchSize)
        const result = await deliverBatchWithRetry({
          target: {
            id: target.id,
            workspaceId: target.workspaceId,
            kind: target.kind,
            endpoint: target.endpoint,
            secret: target.secret,
          },
          events: slice,
          fetchImpl: opts.fetchImpl,
          noWait: opts.noWait,
          now,
        })
        if (result.ok) {
          batchesSent += 1
          eventsSent += slice.length
        } else {
          batchesFailed += 1
        }
      }
    }),
  )

  return {
    targetsProcessed: targets.length,
    batchesSent,
    eventsSent,
    batchesFailed,
  }
}

// ────────────────────────── Delivery con retry ──────────────────────────

type DeliverArgs = {
  target: StreamTargetSnapshot & { kind: AuditStreamKind }
  events: StreamableEvent[]
  fetchImpl?: typeof fetch
  noWait?: boolean
  now: () => Date
  /** Si se pasa, reutiliza el delivery existente en lugar de crear uno nuevo. */
  existingDeliveryId?: string
}

type DeliverResult =
  | { ok: true; deliveryId: string }
  | { ok: false; deliveryId: string; lastError: string }

async function deliverBatchWithRetry(
  args: DeliverArgs,
): Promise<DeliverResult> {
  const adapter = getAdapter(args.target.kind)
  const batchId = randomUUID()

  const delivery = args.existingDeliveryId
    ? await prisma.auditStreamDelivery.update({
        where: { id: args.existingDeliveryId },
        data: { status: 'RETRYING' },
      })
    : await prisma.auditStreamDelivery.create({
        data: {
          targetId: args.target.id,
          batchId,
          count: args.events.length,
          status: 'PENDING',
          attempt: 0,
        },
      })

  let lastError = ''
  for (let attempt = delivery.attempt; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > delivery.attempt) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
      if (!args.noWait) await sleep(delay)
    }
    const result = await runAdapter(adapter, args.target, args.events, args.fetchImpl)
    if (result.ok) {
      await prisma.auditStreamDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SUCCESS',
          attempt: attempt + 1,
          deliveredAt: args.now(),
          lastError: null,
        },
      })
      await prisma.auditStreamTarget.update({
        where: { id: args.target.id },
        data: { lastDeliveryAt: args.now(), lastError: null },
      })
      return { ok: true, deliveryId: delivery.id }
    }
    lastError = result.error
    await prisma.auditStreamDelivery.update({
      where: { id: delivery.id },
      data: {
        attempt: attempt + 1,
        status: attempt + 1 >= MAX_ATTEMPTS ? 'FAILED' : 'RETRYING',
        lastError: truncate(lastError, 500),
      },
    })
  }

  await prisma.auditStreamTarget.update({
    where: { id: args.target.id },
    data: { lastError: truncate(lastError, 500) },
  })
  return { ok: false, deliveryId: delivery.id, lastError }
}

async function runAdapter(
  adapter: Adapter,
  target: StreamTargetSnapshot,
  events: StreamableEvent[],
  fetchImpl?: typeof fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const out = await adapter.send(target, events, fetchImpl)
    if (out.ok) return { ok: true }
    return { ok: false, error: out.error }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// ────────────────────────── Retry cron-driven ──────────────────────────

/**
 * Re-procesa deliveries `FAILED` / `RETRYING` con `attempt < MAX_ATTEMPTS`.
 *
 * Trade-off: en MVP NO re-enviamos eventos antiguos (los buffers
 * in-memory ya están vacíos al momento del retry; reconstruirlos
 * implicaría leer `AuditEvent` por rango temporal y no garantiza
 * idempotencia en el SIEM). El retry simplemente bumpea `attempt` para
 * que el operador vea el contador hasta que un humano marque
 * `lastError = null` o limpie el delivery. La función queda como hook
 * para una futura wave que sí persista el payload del batch.
 */
export async function retryFailedDeliveries(): Promise<{ retried: number }> {
  const stuck = await prisma.auditStreamDelivery.findMany({
    where: {
      status: { in: ['FAILED', 'RETRYING'] },
      attempt: { lt: MAX_ATTEMPTS },
    },
    take: 100,
    orderBy: { createdAt: 'asc' },
  })

  for (const d of stuck) {
    await prisma.auditStreamDelivery.update({
      where: { id: d.id },
      data: {
        attempt: d.attempt + 1,
        status: d.attempt + 1 >= MAX_ATTEMPTS ? 'FAILED' : 'RETRYING',
      },
    })
  }
  return { retried: stuck.length }
}

// ────────────────────────── Helper para tests ──────────────────────────

/** Envío directo (sin cola) útil para `testTarget` y E2E. */
export async function sendTestEvent(
  target: StreamTargetSnapshot & { kind: AuditStreamKind },
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; error?: string }> {
  const adapter = getAdapter(target.kind)
  const sample: StreamableEvent = {
    id: 'test-' + randomUUID(),
    action: 'user.login',
    entityType: 'audit_stream_target',
    entityId: target.id,
    actorId: null,
    workspaceId: target.workspaceId,
    before: null,
    after: { test: true },
    metadata: { test: true, source: 'Sync audit streaming · test event' },
    ipAddress: null,
    userAgent: null,
    createdAt: new Date().toISOString(),
  }
  const res = await adapter.send(target, [sample], fetchImpl)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}
