'use server'

/**
 * Wave P6 · Equipo A4 — Server Actions para gestionar `PushSubscription`.
 *
 * Persiste/elimina suscripciones generadas por `pushManager.subscribe()`
 * en el cliente. Resolución de userId: hereda el patrón de
 * `notifications.ts` (acepta `userId` explícito; si no, cae al hardcode
 * `getDefaultUserId` mientras no haya sesión real).
 *
 * Errores tipados:
 *   - `[INVALID_INPUT] detalle` — payload zod inválido.
 *   - `[UNAUTHORIZED] detalle` — no hay usuario resoluble (BD vacía).
 */

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export type PushSubscriptionErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED'

function actionError(code: PushSubscriptionErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  /** UA opcional (informativo para UI de "dispositivos activos"). */
  userAgent: z.string().max(500).nullish(),
  /** Cuando hay sesión real, este campo se ignora; mientras no, lo usamos. */
  userId: z.string().min(1).nullish(),
})

export type SubscribeToPushInput = z.input<typeof subscriptionSchema>

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
  userId: z.string().min(1).nullish(),
})

export type UnsubscribeFromPushInput = z.input<typeof unsubscribeSchema>

// ───────────────────────── Auth fallback ─────────────────────────

async function getDefaultUserId(): Promise<string> {
  const edwin = await prisma.user.findFirst({
    where: { name: 'Edwin Martinez' },
    select: { id: true },
  })
  if (edwin) return edwin.id
  const fallback = await prisma.user.findFirst({
    orderBy: { name: 'asc' },
    select: { id: true },
  })
  if (!fallback) actionError('UNAUTHORIZED', 'No hay usuarios en la base de datos')
  return fallback.id
}

async function resolveUserId(userId?: string | null): Promise<string> {
  if (userId && userId.length > 0) return userId
  return getDefaultUserId()
}

// ───────────────────────── Server actions ─────────────────────────

export type SerializedPushSubscription = {
  id: string
  userId: string
  endpoint: string
  userAgent: string | null
  createdAt: string
  lastUsedAt: string | null
}

/**
 * Upsert idempotente por `endpoint`. Si el endpoint ya existía pero
 * pertenece a otro usuario (cambio de cuenta en el mismo browser), se
 * reasigna al userId actual y se rota la fecha.
 */
export async function subscribeToPush(
  input: SubscribeToPushInput,
): Promise<SerializedPushSubscription> {
  const parsed = subscriptionSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data
  const userId = await resolveUserId(data.userId)

  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    create: {
      userId,
      endpoint: data.endpoint,
      keys: data.keys as unknown as Prisma.InputJsonValue,
      userAgent: data.userAgent ?? null,
    },
    update: {
      userId,
      keys: data.keys as unknown as Prisma.InputJsonValue,
      userAgent: data.userAgent ?? null,
      lastUsedAt: new Date(),
    },
    select: {
      id: true,
      userId: true,
      endpoint: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
    },
  })

  return {
    id: row.id,
    userId: row.userId,
    endpoint: row.endpoint,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  }
}

/**
 * Borra la suscripción del endpoint dado, si pertenece al usuario actual.
 * Idempotente: si no existe devuelve `{ removed: 0 }` sin lanzar.
 */
export async function unsubscribeFromPush(
  input: UnsubscribeFromPushInput,
): Promise<{ removed: number }> {
  const parsed = unsubscribeSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const userId = await resolveUserId(parsed.data.userId)

  const result = await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId },
  })

  return { removed: result.count }
}

/**
 * Lista las suscripciones del usuario actual (dispositivos activos).
 * Útil para UI futura "Notificaciones activas en N dispositivos".
 */
export async function listPushSubscriptions(
  userId?: string | null,
): Promise<SerializedPushSubscription[]> {
  const uid = await resolveUserId(userId ?? null)
  const rows = await prisma.pushSubscription.findMany({
    where: { userId: uid },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      endpoint: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    endpoint: r.endpoint,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }))
}
