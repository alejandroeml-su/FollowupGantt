'use server'

/**
 * Server actions para administrar webhooks (Ola P4 · Equipo P4-2).
 *
 * Cada webhook pertenece al usuario que lo crea. El secret se persiste en
 * claro porque el dispatcher debe regenerar la firma HMAC en cada delivery
 * (no podemos hashearlo). Para mostrarlo en la UI lo enmascaramos por
 * convención (`hex_•••••<últimos4>`); el valor real solo se entrega vía
 * `getWebhookSecret` con confirmación explícita.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { generateWebhookSecret } from '@/lib/webhooks/signature'
import { KNOWN_EVENTS, type WebhookEventType } from '@/lib/webhooks/dispatcher'

// ───────────────────────── Errores tipados ─────────────────────────

export type WebhookErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_URL'
  | 'INVALID_EVENTS'
  | 'NOT_FOUND'
  | 'FORBIDDEN'

function actionError(code: WebhookErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const URL_MAX = 2048

const urlSchema = z
  .string()
  .min(1)
  .max(URL_MAX)
  .refine((u) => {
    try {
      const parsed = new URL(u)
      // En dev permitimos http; en prod forzamos https.
      if (process.env.NODE_ENV === 'production') {
        return parsed.protocol === 'https:'
      }
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    } catch {
      return false
    }
  }, 'URL inválida (https requerido en producción)')

const createSchema = z.object({
  url: urlSchema,
  events: z.array(z.string()).min(1),
  active: z.boolean().optional(),
})

export type CreateWebhookInput = z.input<typeof createSchema>

const updateSchema = z
  .object({
    id: z.string().min(1),
    url: urlSchema.optional(),
    events: z.array(z.string()).min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) => v.url !== undefined || v.events !== undefined || v.active !== undefined,
    { message: 'Debe especificar al menos un campo a actualizar' },
  )

export type UpdateWebhookInput = z.input<typeof updateSchema>

// ───────────────────────── Helpers ─────────────────────────

const KNOWN_EVENT_SET: ReadonlySet<string> = new Set<string>([
  ...KNOWN_EVENTS,
  '*',
])

function validateEvents(input: string[]): WebhookEventType[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of input) {
    if (!KNOWN_EVENT_SET.has(e)) continue
    if (seen.has(e)) continue
    seen.add(e)
    out.push(e)
  }
  return out as WebhookEventType[]
}

// ───────────────────────── Mutations ─────────────────────────

/**
 * Crea un webhook con un secret nuevo. Devuelve el secret en claro UNA SOLA
 * VEZ (la UI debe mostrarlo con copy-to-clipboard). El receptor lo necesita
 * para verificar la firma.
 */
export async function createWebhook(input: CreateWebhookInput): Promise<{
  id: string
  secret: string
  url: string
  events: string[]
  active: boolean
}> {
  const user = await requireUser()

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues
    const urlIssue = issues.find((i) => i.path[0] === 'url')
    if (urlIssue) actionError('INVALID_URL', urlIssue.message)
    actionError('INVALID_INPUT', issues.map((i) => i.message).join('; '))
  }

  const { url, events: rawEvents, active = true } = parsed.data
  const events = validateEvents(rawEvents)
  if (events.length === 0) {
    actionError(
      'INVALID_EVENTS',
      `Eventos no reconocidos. Válidos: ${[...KNOWN_EVENTS, '*'].join(', ')}`,
    )
  }

  const secret = generateWebhookSecret()
  const created = await prisma.webhook.create({
    data: {
      url,
      secret,
      events,
      active,
      userId: user.id,
    },
    select: { id: true, url: true, events: true, active: true },
  })

  revalidatePath('/settings/webhooks')

  return {
    id: created.id,
    secret,
    url: created.url,
    events: created.events as string[],
    active: created.active,
  }
}

/**
 * Actualiza url/events/active. NO permite rotar el secret aquí (eso requeriría
 * coordinación con el receptor). El secret solo se regenera al recrear.
 */
export async function updateWebhook(input: UpdateWebhookInput): Promise<{ id: string }> {
  const user = await requireUser()

  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { id, url, events, active } = parsed.data

  const existing = await prisma.webhook.findUnique({
    where: { id },
    select: { id: true, userId: true },
  })
  if (!existing) actionError('NOT_FOUND', 'Webhook no encontrado')
  if (existing.userId !== user.id) {
    actionError('FORBIDDEN', 'No puedes modificar webhooks de otros usuarios')
  }

  const data: { url?: string; events?: WebhookEventType[]; active?: boolean } = {}
  if (url !== undefined) data.url = url
  if (events !== undefined) {
    const validated = validateEvents(events)
    if (validated.length === 0) {
      actionError(
        'INVALID_EVENTS',
        `Eventos no reconocidos. Válidos: ${[...KNOWN_EVENTS, '*'].join(', ')}`,
      )
    }
    data.events = validated
  }
  if (active !== undefined) data.active = active

  const updated = await prisma.webhook.update({
    where: { id },
    data,
    select: { id: true },
  })

  revalidatePath('/settings/webhooks')
  return updated
}

/**
 * Elimina un webhook. Idempotente: si ya no existe, no lanza.
 */
export async function deleteWebhook(input: { id: string }): Promise<{ ok: true }> {
  const user = await requireUser()
  if (!input?.id) actionError('INVALID_INPUT', 'id requerido')

  const existing = await prisma.webhook.findUnique({
    where: { id: input.id },
    select: { id: true, userId: true },
  })
  if (!existing) return { ok: true as const }
  if (existing.userId !== user.id) {
    actionError('FORBIDDEN', 'No puedes eliminar webhooks de otros usuarios')
  }

  await prisma.webhook.delete({ where: { id: existing.id } })
  revalidatePath('/settings/webhooks')
  return { ok: true as const }
}

// ───────────────────────── Queries ─────────────────────────

export interface WebhookListItem {
  id: string
  url: string
  events: string[]
  active: boolean
  secretMasked: string
  lastDeliveryAt: string | null
  lastDeliveryStatus: number | null
  failureCount: number
  createdAt: string
}

function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) return '•••••'
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`
}

export async function listWebhooksForUser(): Promise<WebhookListItem[]> {
  const user = await requireUser()
  const rows = await prisma.webhook.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      url: true,
      events: true,
      active: true,
      secret: true,
      lastDeliveryAt: true,
      lastDeliveryStatus: true,
      failureCount: true,
      createdAt: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    events: (r.events as string[]) ?? [],
    active: r.active,
    secretMasked: maskSecret(r.secret),
    lastDeliveryAt: r.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryStatus: r.lastDeliveryStatus,
    failureCount: r.failureCount,
    createdAt: r.createdAt.toISOString(),
  }))
}
