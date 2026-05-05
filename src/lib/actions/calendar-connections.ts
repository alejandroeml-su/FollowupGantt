'use server'

/**
 * Wave P8 · Equipo P8-5 — Server actions CRUD para `CalendarConnection`.
 *
 * Convenciones del repo:
 *   - Errores tipados con prefijo `[CODE] detalle`.
 *   - Auth: `requireUser` (sesión real ya disponible en P3-1+).
 *   - `revalidatePath('/settings/calendar')` tras mutar.
 *   - Toggle granular: `updateSyncToggles` permite habilitar/deshabilitar
 *     por tipo (milestones/deadlines/sprints) sin tocar tokens OAuth.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { randomBytes } from 'node:crypto'
import { CalendarProvider } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'

export type CalendarConnectionErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONNECTION_EXISTS'

function actionError(
  code: CalendarConnectionErrorCode,
  detail: string,
): never {
  throw new Error(`[${code}] ${detail}`)
}

function revalidate() {
  revalidatePath('/settings/calendar')
}

// ─────────────────────────── Schemas ───────────────────────────

const providerEnum = z.enum(['GOOGLE', 'MICROSOFT', 'ICS'])

const upsertOAuthSchema = z.object({
  provider: providerEnum,
  accessToken: z.string().min(1),
  refreshToken: z.string().nullish(),
  expiresAt: z.coerce.date().nullish(),
  externalId: z.string().nullish(),
})

const toggleSchema = z.object({
  connectionId: z.string().min(1),
  syncEnabled: z.boolean().optional(),
  syncMilestones: z.boolean().optional(),
  syncDeadlines: z.boolean().optional(),
  syncSprints: z.boolean().optional(),
})

const deleteSchema = z.object({
  connectionId: z.string().min(1),
})

const ensureIcsSchema = z.object({})

// ─────────────────────────── Tipos serializables ───────────────────────────

export interface SerializedCalendarConnection {
  id: string
  userId: string
  provider: 'GOOGLE' | 'MICROSOFT' | 'ICS'
  syncEnabled: boolean
  syncMilestones: boolean
  syncDeadlines: boolean
  syncSprints: boolean
  hasAccessToken: boolean // NO exponemos el token al cliente
  hasRefreshToken: boolean
  externalId: string | null
  icsToken: string | null
  lastSyncAt: string | null
  expiresAt: string | null
  createdAt: string
}

function serialize(row: {
  id: string
  userId: string
  provider: CalendarProvider
  syncEnabled: boolean
  syncMilestones: boolean
  syncDeadlines: boolean
  syncSprints: boolean
  accessToken: string | null
  refreshToken: string | null
  externalId: string | null
  icsToken: string | null
  lastSyncAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}): SerializedCalendarConnection {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    syncEnabled: row.syncEnabled,
    syncMilestones: row.syncMilestones,
    syncDeadlines: row.syncDeadlines,
    syncSprints: row.syncSprints,
    hasAccessToken: Boolean(row.accessToken),
    hasRefreshToken: Boolean(row.refreshToken),
    externalId: row.externalId,
    icsToken: row.icsToken,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

// ─────────────────────────── Actions ───────────────────────────

/** Lista las conexiones del usuario actual. */
export async function listMyCalendarConnections(): Promise<
  SerializedCalendarConnection[]
> {
  const user = await requireUser()
  const rows = await prisma.calendarConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(serialize)
}

/**
 * Persiste tokens OAuth tras callback. Reusa upsert por (userId,provider)
 * para soportar reconexión.
 */
export async function upsertOAuthConnection(input: {
  provider: 'GOOGLE' | 'MICROSOFT'
  accessToken: string
  refreshToken?: string | null
  expiresAt?: Date | string | null
  externalId?: string | null
}): Promise<SerializedCalendarConnection> {
  const user = await requireUser()
  const parsed = upsertOAuthSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  if (parsed.data.provider === 'ICS') {
    actionError('INVALID_INPUT', 'ICS no usa OAuth, llama a ensureIcsConnection')
  }

  const row = await prisma.calendarConnection.upsert({
    where: {
      userId_provider: { userId: user.id, provider: parsed.data.provider },
    },
    create: {
      userId: user.id,
      provider: parsed.data.provider,
      accessToken: parsed.data.accessToken,
      refreshToken: parsed.data.refreshToken ?? null,
      expiresAt: parsed.data.expiresAt ?? null,
      externalId: parsed.data.externalId ?? null,
      syncEnabled: true,
    },
    update: {
      accessToken: parsed.data.accessToken,
      refreshToken: parsed.data.refreshToken ?? undefined,
      expiresAt: parsed.data.expiresAt ?? undefined,
      externalId: parsed.data.externalId ?? undefined,
      syncEnabled: true,
    },
  })

  revalidate()
  return serialize(row)
}

/**
 * Crea (o devuelve si ya existe) la conexión ICS del usuario y genera
 * `icsToken` aleatorio. El token rota llamando a `rotateIcsToken`.
 */
export async function ensureIcsConnection(): Promise<SerializedCalendarConnection> {
  const user = await requireUser()
  ensureIcsSchema.parse({}) // future-proof: si añadimos opciones.

  const existing = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: user.id, provider: 'ICS' } },
  })
  if (existing) {
    if (!existing.icsToken) {
      const updated = await prisma.calendarConnection.update({
        where: { id: existing.id },
        data: { icsToken: generateIcsToken() },
      })
      revalidate()
      return serialize(updated)
    }
    return serialize(existing)
  }

  const row = await prisma.calendarConnection.create({
    data: {
      userId: user.id,
      provider: 'ICS',
      icsToken: generateIcsToken(),
      syncEnabled: true,
    },
  })
  revalidate()
  return serialize(row)
}

/** Genera un nuevo `icsToken` invalidando el anterior. */
export async function rotateIcsToken(): Promise<SerializedCalendarConnection> {
  const user = await requireUser()
  const existing = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: user.id, provider: 'ICS' } },
  })
  if (!existing) {
    actionError('NOT_FOUND', 'No hay conexión ICS para este usuario')
  }
  const updated = await prisma.calendarConnection.update({
    where: { id: existing.id },
    data: { icsToken: generateIcsToken() },
  })
  revalidate()
  return serialize(updated)
}

/** Actualiza toggles granulares de sync. */
export async function updateSyncToggles(input: {
  connectionId: string
  syncEnabled?: boolean
  syncMilestones?: boolean
  syncDeadlines?: boolean
  syncSprints?: boolean
}): Promise<SerializedCalendarConnection> {
  const user = await requireUser()
  const parsed = toggleSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }

  const conn = await prisma.calendarConnection.findUnique({
    where: { id: parsed.data.connectionId },
  })
  if (!conn) actionError('NOT_FOUND', 'Conexión no encontrada')
  if (conn.userId !== user.id) {
    actionError('FORBIDDEN', 'La conexión pertenece a otro usuario')
  }

  const updated = await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: {
      syncEnabled: parsed.data.syncEnabled ?? undefined,
      syncMilestones: parsed.data.syncMilestones ?? undefined,
      syncDeadlines: parsed.data.syncDeadlines ?? undefined,
      syncSprints: parsed.data.syncSprints ?? undefined,
    },
  })
  revalidate()
  return serialize(updated)
}

/** Borra la conexión (CASCADE → CalendarEvent). */
export async function deleteConnection(input: {
  connectionId: string
}): Promise<{ removed: number }> {
  const user = await requireUser()
  const parsed = deleteSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', 'connectionId requerido')

  const conn = await prisma.calendarConnection.findUnique({
    where: { id: parsed.data.connectionId },
    select: { id: true, userId: true },
  })
  if (!conn) return { removed: 0 }
  if (conn.userId !== user.id) {
    actionError('FORBIDDEN', 'La conexión pertenece a otro usuario')
  }

  await prisma.calendarConnection.delete({ where: { id: conn.id } })
  revalidate()
  return { removed: 1 }
}

/** Genera un token ICS URL-safe (32 bytes → 43 chars base64url). */
function generateIcsToken(): string {
  return randomBytes(32).toString('base64url')
}
