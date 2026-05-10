'use server'

/**
 * Wave P17-B · Server actions de Webhook Subscriptions v2 (workspace-scoped).
 *
 * Convenciones:
 *   - Usuario autenticado + miembro del workspace activo.
 *   - El `secret` se genera server-side y SE DEVUELVE al crear (UNA vez).
 *   - URL debe ser `https://...` (validamos en zod + parser nativo).
 *   - Errores tipados `[CODE] detalle`.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import {
  generateWebhookSecret,
} from '@/lib/webhooks-out/signature'
import {
  KNOWN_V2_EVENTS,
  validateV2Events,
} from '@/lib/webhooks-out/events'
import { getActiveWorkspaceId } from '@/lib/actions/workspaces'
import { getDefaultWorkspaceForUser } from '@/lib/auth/check-workspace-access'

export type WebhookSubErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_EVENTS'
  | 'INVALID_URL'
  | 'NOT_FOUND'
  | 'FORBIDDEN'

function actionError(code: WebhookSubErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

const URL_MAX = 2048

const createSchema = z.object({
  url: z.string().min(1).max(URL_MAX),
  events: z.array(z.string()).min(1),
  active: z.boolean().optional(),
})
export type CreateWebhookSubInput = z.input<typeof createSchema>

const updateSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1).max(URL_MAX).optional(),
  events: z.array(z.string()).min(1).optional(),
  active: z.boolean().optional(),
})
export type UpdateWebhookSubInput = z.input<typeof updateSchema>

const idSchema = z.object({ id: z.string().min(1) })

function assertHttpsUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    actionError('INVALID_URL', 'URL inválida')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    actionError('INVALID_URL', 'URL debe ser http(s)')
  }
  return parsed.toString()
}

async function resolveWorkspaceId(userId: string): Promise<string> {
  const active = await getActiveWorkspaceId()
  if (active) return active
  const fallback = await getDefaultWorkspaceForUser(userId)
  return fallback.id
}

/**
 * Crea una WebhookSubscription v2. Devuelve el `secret` UNA SOLA VEZ —
 * la lista posterior solo muestra `secretPrefix` (los primeros chars).
 */
export async function createWebhookSubscription(
  input: CreateWebhookSubInput,
): Promise<{
  id: string
  secret: string
  url: string
  events: string[]
  active: boolean
}> {
  const user = await requireUser()
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const url = assertHttpsUrl(parsed.data.url)
  const validated = validateV2Events(parsed.data.events)
  if (validated.length === 0) {
    actionError(
      'INVALID_EVENTS',
      `Eventos no reconocidos. Válidos: ${KNOWN_V2_EVENTS.join(', ')}`,
    )
  }

  const workspaceId = await resolveWorkspaceId(user.id)
  const secret = generateWebhookSecret()

  const created = await prisma.webhookSubscription.create({
    data: {
      workspaceId,
      url,
      secret,
      events: validated,
      active: parsed.data.active ?? true,
      createdById: user.id,
    },
    select: { id: true, url: true, events: true, active: true },
  })

  revalidatePath('/settings/webhooks-v2')

  return {
    id: created.id,
    secret,
    url: created.url,
    events: created.events,
    active: created.active,
  }
}

/**
 * Actualiza url/events/active. NO permite rotar el secret aquí —
 * para eso se usa `rotateWebhookSecret`.
 */
export async function updateWebhookSubscription(
  input: UpdateWebhookSubInput,
): Promise<{ ok: true }> {
  const user = await requireUser()
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const workspaceId = await resolveWorkspaceId(user.id)
  const sub = await prisma.webhookSubscription.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, workspaceId: true },
  })
  if (!sub) actionError('NOT_FOUND', 'Webhook no encontrado')
  if (sub.workspaceId !== workspaceId) {
    actionError('FORBIDDEN', 'No puedes editar webhooks de otro workspace')
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.url !== undefined) data.url = assertHttpsUrl(parsed.data.url)
  if (parsed.data.events !== undefined) {
    const events = validateV2Events(parsed.data.events)
    if (events.length === 0) {
      actionError(
        'INVALID_EVENTS',
        `Eventos no reconocidos. Válidos: ${KNOWN_V2_EVENTS.join(', ')}`,
      )
    }
    data.events = events
  }
  if (parsed.data.active !== undefined) {
    data.active = parsed.data.active
    // Reactivar resetea failureCount para dar segunda oportunidad.
    if (parsed.data.active) data.failureCount = 0
  }

  if (Object.keys(data).length === 0) {
    return { ok: true as const }
  }

  await prisma.webhookSubscription.update({
    where: { id: parsed.data.id },
    data,
  })

  revalidatePath('/settings/webhooks-v2')
  return { ok: true as const }
}

/**
 * Borra la WebhookSubscription (cascade purga deliveries).
 */
export async function deleteWebhookSubscription(input: {
  id: string
}): Promise<{ ok: true }> {
  const user = await requireUser()
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', 'id requerido')

  const workspaceId = await resolveWorkspaceId(user.id)
  const sub = await prisma.webhookSubscription.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, workspaceId: true },
  })
  if (!sub) return { ok: true as const }
  if (sub.workspaceId !== workspaceId) {
    actionError('FORBIDDEN', 'No puedes eliminar webhooks de otro workspace')
  }

  await prisma.webhookSubscription.delete({ where: { id: sub.id } })
  revalidatePath('/settings/webhooks-v2')
  return { ok: true as const }
}

export interface WebhookSubListItem {
  id: string
  url: string
  events: string[]
  active: boolean
  secretPrefix: string
  failureCount: number
  lastDeliveryAt: string | null
  createdAt: string
}

/**
 * Lista subscriptions del workspace activo. Devuelve solo el prefix del
 * secret (8 chars) — el plaintext del secret se mostró al crear.
 */
export async function listWebhookSubscriptions(): Promise<WebhookSubListItem[]> {
  const user = await requireUser()
  const workspaceId = await resolveWorkspaceId(user.id)

  const rows = await prisma.webhookSubscription.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      url: true,
      secret: true,
      events: true,
      active: true,
      failureCount: true,
      lastDeliveryAt: true,
      createdAt: true,
    },
  })

  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    events: r.events,
    active: r.active,
    secretPrefix: r.secret.slice(0, 8),
    failureCount: r.failureCount,
    lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}
