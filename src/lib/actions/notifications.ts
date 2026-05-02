'use server'

/**
 * Ola P1 · Centro de notificaciones in-app + preferencias.
 *
 * Pieza pública de la pieza "@menciones reales": persiste cada evento
 * notificable contra `Notification` para que el badge del Bell muestre
 * un count fiable y el dropdown pinte la lista. El email (Resend) sigue
 * siendo un canal independiente que respeta `NotificationPreference`.
 *
 * Convenciones del repo:
 *   - Errores tipados con prefijo `[CODE] detalle`.
 *   - `unstable_cache` con tag `notifications:<userId>` para el listado y
 *     el count de no-leídas. `markRead*` y `createNotification` invalidan
 *     el tag con `revalidateTag` (perfil 'max', consistente con CPM).
 *   - Sin auth real: actions que necesitan saber "quién soy yo" aceptan
 *     `userId` explícito; cuando se omite, caen al hardcode `getDefaultUserId`
 *     (mismo hack que `updateTask` y `addTaskCollaborator`).
 *   - Persistencia disparada por otras actions vía `createNotification`:
 *     mantener este archivo libre de side-effects de email.
 */

import { z } from 'zod'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { Prisma, type NotificationType } from '@prisma/client'
import prisma from '@/lib/prisma'

// ───────────────────────── Errores tipados ─────────────────────────

export type NotificationErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'

function actionError(code: NotificationErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas / Tipos ─────────────────────────

const notificationTypeEnum = z.enum([
  'MENTION',
  'TASK_ASSIGNED',
  'COMMENT_REPLY',
  'BASELINE_CAPTURED',
  'DEPENDENCY_VIOLATION',
  'IMPORT_COMPLETED',
])

const createNotificationSchema = z.object({
  userId: z.string().min(1),
  type: notificationTypeEnum,
  title: z.string().min(1).max(200),
  body: z.string().max(2000).nullish(),
  link: z.string().max(500).nullish(),
  // `data` se acepta como JSON serializable opcional. Validamos shape mínimo
  // (objeto plano) para evitar grafos cíclicos que rompan Prisma.
  data: z.record(z.string(), z.unknown()).nullish(),
})

export type CreateNotificationInput = z.input<typeof createNotificationSchema>

const preferencesSchema = z
  .object({
    userId: z.string().min(1),
    emailMentions: z.boolean().optional(),
    emailAssignments: z.boolean().optional(),
    emailDigest: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.emailMentions !== undefined ||
      v.emailAssignments !== undefined ||
      v.emailDigest !== undefined,
    { message: 'Al menos un toggle debe especificarse' },
  )

export type UpdatePreferencesInput = z.input<typeof preferencesSchema>

export type SerializedNotification = {
  id: string
  userId: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  data: Prisma.JsonValue | null
  readAt: string | null
  createdAt: string
}

function serialize(row: {
  id: string
  userId: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  data: Prisma.JsonValue | null
  readAt: Date | null
  createdAt: Date
}): SerializedNotification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    data: row.data ?? null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

// ───────────────────────── Cache helpers ─────────────────────────

function getNotificationsCached(userId: string, limit: number, unreadOnly: boolean) {
  return unstable_cache(
    async (uid: string, lim: number, unread: boolean) => {
      const rows = await prisma.notification.findMany({
        where: unread ? { userId: uid, readAt: null } : { userId: uid },
        orderBy: { createdAt: 'desc' },
        take: lim,
      })
      return rows.map(serialize)
    },
    ['notifications-list', userId, String(limit), String(unreadOnly)],
    { tags: [`notifications:${userId}`] },
  )(userId, limit, unreadOnly)
}

function getUnreadCountCached(userId: string) {
  return unstable_cache(
    async (uid: string) => {
      return prisma.notification.count({ where: { userId: uid, readAt: null } })
    },
    ['notifications-unread-count', userId],
    { tags: [`notifications:${userId}`] },
  )(userId)
}

export async function invalidateNotificationsCache(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return
  // Perfil 'max' = stale-while-revalidate, mismo patrón que `invalidateCpmCache`.
  revalidateTag(`notifications:${userId}`, 'max')
}

// ───────────────────────── Auth fallback ─────────────────────────

/**
 * Hack temporal: sin sesión real, devolvemos el primer usuario por nombre
 * "Edwin Martinez" (Sidebar lo trata como SUPER_ADMIN). Si no existe,
 * caemos al primer usuario alfabético — la action es defensiva pero no
 * silencia el problema: lanza `[NOT_FOUND]` si la tabla está vacía.
 */
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
  if (!fallback) actionError('NOT_FOUND', 'No hay usuarios en la base de datos')
  return fallback.id
}

async function resolveUserId(userId?: string | null): Promise<string> {
  if (userId && userId.length > 0) return userId
  return getDefaultUserId()
}

// ───────────────────────── Server actions: create ─────────────────────────

/**
 * Crea una notificación in-app para un usuario. Pensado para ser invocado
 * **internamente** por otras server actions (createComment, captureBaseline,
 * importExcel…), no expuesto a clientes vía form action.
 *
 * Tolerancia a fallos: si Prisma rechaza por FK (userId inexistente), NO
 * tira la operación principal — la action principal ya cumplió su SLA y
 * la notificación es side-channel. El caller decide si propaga o swallow:
 * el contrato es que `createNotification` sí lanza, pero los callers en
 * `actions.ts` lo envuelven en try/catch.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<SerializedNotification> {
  const parsed = createNotificationSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  const created = await prisma.notification.create({
    data: {
      userId: data.userId,
      type: data.type,
      title: data.title,
      body: data.body ?? null,
      link: data.link ?? null,
      data: data.data
        ? (data.data as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  })

  await invalidateNotificationsCache(data.userId)
  return serialize(created)
}

/**
 * Versión "broadcast" que crea N notificaciones en una sola transacción.
 * Útil para `createComment` cuando hay varios mencionados — evita N
 * round-trips. Acepta dedupe por userId para tolerar @todos + @nombre del
 * mismo usuario.
 */
export async function createNotificationsBatch(
  inputs: CreateNotificationInput[],
): Promise<{ count: number }> {
  if (!inputs.length) return { count: 0 }

  const seen = new Set<string>()
  const valid: CreateNotificationInput[] = []
  for (const i of inputs) {
    const parsed = createNotificationSchema.safeParse(i)
    if (!parsed.success) continue
    const key = `${parsed.data.userId}:${parsed.data.type}:${parsed.data.title}`
    if (seen.has(key)) continue
    seen.add(key)
    valid.push(parsed.data)
  }
  if (!valid.length) return { count: 0 }

  const result = await prisma.notification.createMany({
    data: valid.map((d) => ({
      userId: d.userId,
      type: d.type,
      title: d.title,
      body: d.body ?? null,
      link: d.link ?? null,
      data: d.data
        ? (d.data as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    })),
  })

  // Invalida cache de cada destinatario único. Una sola tag-invalidation
  // por userId — no por notificación.
  const uniqueUsers = new Set(valid.map((v) => v.userId))
  for (const uid of uniqueUsers) await invalidateNotificationsCache(uid)

  return { count: result.count }
}

// ───────────────────────── Server actions: read ─────────────────────────

/**
 * Lista las notificaciones del usuario actual (más recientes primero).
 * `limit` máximo 50 (el dropdown muestra 10, la página /notifications
 * pagina externamente).
 */
export async function getNotificationsForCurrentUser(
  opts: { limit?: number; unreadOnly?: boolean; userId?: string | null } = {},
): Promise<SerializedNotification[]> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50)
  const unreadOnly = opts.unreadOnly ?? false
  const userId = await resolveUserId(opts.userId ?? null)
  return getNotificationsCached(userId, limit, unreadOnly)
}

/**
 * Count de no-leídas del usuario actual. Cacheado y barato (uno por
 * petición; el polling del Bell lo refresca cada 30s en cliente).
 */
export async function getUnreadCount(userId?: string | null): Promise<number> {
  const uid = await resolveUserId(userId ?? null)
  return getUnreadCountCached(uid)
}

// ───────────────────────── Server actions: mark ─────────────────────────

/**
 * Marca una notificación como leída. Idempotente: si ya estaba leída
 * conserva el `readAt` original. Lanza `[NOT_FOUND]` si la notificación
 * no existe; lanza `[FORBIDDEN]` si pertenece a otro usuario (defensa
 * server-side aunque la UI ya filtre por usuario).
 */
export async function markNotificationRead(
  id: string,
  userId?: string | null,
): Promise<{ id: string; readAt: string }> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const uid = await resolveUserId(userId ?? null)

  const existing = await prisma.notification.findUnique({
    where: { id },
    select: { id: true, userId: true, readAt: true },
  })
  if (!existing) actionError('NOT_FOUND', 'La notificación no existe')
  if (existing.userId !== uid) {
    actionError('FORBIDDEN', 'No puedes modificar notificaciones de otro usuario')
  }

  if (existing.readAt) {
    await invalidateNotificationsCache(uid)
    return { id: existing.id, readAt: existing.readAt.toISOString() }
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
    select: { id: true, readAt: true },
  })
  await invalidateNotificationsCache(uid)
  revalidatePath('/notifications')
  return { id: updated.id, readAt: updated.readAt!.toISOString() }
}

/**
 * Marca todas las notificaciones del usuario como leídas. Devuelve el
 * número de filas afectadas para que la UI muestre toast.
 */
export async function markAllNotificationsRead(
  userId?: string | null,
): Promise<{ count: number }> {
  const uid = await resolveUserId(userId ?? null)
  const result = await prisma.notification.updateMany({
    where: { userId: uid, readAt: null },
    data: { readAt: new Date() },
  })
  await invalidateNotificationsCache(uid)
  revalidatePath('/notifications')
  return { count: result.count }
}

// ───────────────────────── Server actions: preferences ─────────────────────────

/**
 * Lee preferencias del usuario. Si nunca se han creado, devuelve los
 * defaults del schema (no hace upsert silencioso para mantener idempotencia
 * de lectura).
 */
export async function getNotificationPreferences(userId?: string | null): Promise<{
  userId: string
  emailMentions: boolean
  emailAssignments: boolean
  emailDigest: boolean
}> {
  const uid = await resolveUserId(userId ?? null)
  const row = await prisma.notificationPreference.findUnique({
    where: { userId: uid },
    select: {
      userId: true,
      emailMentions: true,
      emailAssignments: true,
      emailDigest: true,
    },
  })
  if (row) return row
  return {
    userId: uid,
    emailMentions: true,
    emailAssignments: true,
    emailDigest: false,
  }
}

/**
 * Actualiza (upsert) las preferencias del usuario. Si la fila no existe,
 * crea una con los defaults + overrides recibidos.
 */
export async function updateNotificationPreferences(
  prefs: UpdatePreferencesInput,
): Promise<{
  userId: string
  emailMentions: boolean
  emailAssignments: boolean
  emailDigest: boolean
}> {
  const parsed = preferencesSchema.safeParse(prefs)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { userId, ...toggles } = parsed.data

  const result = await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      emailMentions: toggles.emailMentions ?? true,
      emailAssignments: toggles.emailAssignments ?? true,
      emailDigest: toggles.emailDigest ?? false,
    },
    update: toggles,
    select: {
      userId: true,
      emailMentions: true,
      emailAssignments: true,
      emailDigest: true,
    },
  })

  revalidatePath('/settings')
  return result
}
