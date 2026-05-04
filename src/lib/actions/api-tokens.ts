'use server'

/**
 * Server actions para administrar API tokens (Ola P4 · Equipo P4-2).
 *
 * Los tokens pertenecen al usuario autenticado (sesión cookie); cada usuario
 * gestiona los suyos. Los SUPER_ADMIN/ADMIN pueden listar tokens de cualquier
 * usuario en una iteración futura (queda fuera de P4).
 *
 * El plaintext SOLO se devuelve al crear (`createApiToken`); luego solo se
 * persiste el hash. La UI muestra el plaintext una vez con copy-to-clipboard
 * y advertencia explícita.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { generateApiToken } from '@/lib/api/auth-token'
import { validateScopes, KNOWN_SCOPES } from '@/lib/api/scopes'

// ───────────────────────── Errores tipados ─────────────────────────

export type ApiTokenErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCOPES'
  | 'NOT_FOUND'
  | 'FORBIDDEN'

function actionError(code: ApiTokenErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const NAME_MAX = 80

const createSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  scopes: z.array(z.string()).min(1),
  // ISO date string opcional. null = no expira.
  expiresAt: z.string().datetime().optional().nullable(),
})

export type CreateApiTokenInput = z.input<typeof createSchema>

const revokeSchema = z.object({
  id: z.string().min(1),
})

// ───────────────────────── Mutations ─────────────────────────

/**
 * Crea un nuevo token para el usuario autenticado y devuelve el plaintext
 * UNA SOLA VEZ. La UI debe mostrar este valor con copy-to-clipboard y
 * advertencia explícita ("guárdalo, no podrás verlo de nuevo").
 */
export async function createApiToken(input: CreateApiTokenInput): Promise<{
  id: string
  plaintext: string
  prefix: string
  scopes: string[]
}> {
  const user = await requireUser()

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { name, scopes: rawScopes, expiresAt } = parsed.data

  const validated = validateScopes(rawScopes)
  if (validated.length === 0) {
    actionError(
      'INVALID_SCOPES',
      `Scopes no reconocidos. Válidos: ${KNOWN_SCOPES.join(', ')}`,
    )
  }

  const { plaintext, tokenHash, prefix } = generateApiToken()

  const created = await prisma.apiToken.create({
    data: {
      name: name.trim(),
      tokenHash,
      prefix,
      scopes: validated,
      userId: user.id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    select: { id: true, prefix: true, scopes: true },
  })

  revalidatePath('/settings/api')

  return {
    id: created.id,
    plaintext,
    prefix: created.prefix,
    scopes: created.scopes as string[],
  }
}

/**
 * Marca un token como revocado (`revokedAt = now`). El token deja de
 * autenticar inmediatamente. Idempotente: revocar dos veces no cambia el
 * timestamp original.
 */
export async function revokeApiToken(input: { id: string }): Promise<{ ok: true }> {
  const user = await requireUser()
  const parsed = revokeSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', 'id requerido')

  const token = await prisma.apiToken.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, userId: true, revokedAt: true },
  })
  if (!token) actionError('NOT_FOUND', 'Token no encontrado')
  if (token.userId !== user.id) {
    actionError('FORBIDDEN', 'No puedes revocar tokens de otros usuarios')
  }

  if (!token.revokedAt) {
    await prisma.apiToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    })
  }

  revalidatePath('/settings/api')
  return { ok: true as const }
}

/**
 * Elimina permanentemente un token. Equivalente a revokar + borrar el row.
 * Útil para limpiar la lista en la UI.
 */
export async function deleteApiToken(input: { id: string }): Promise<{ ok: true }> {
  const user = await requireUser()
  const parsed = revokeSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', 'id requerido')

  const token = await prisma.apiToken.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, userId: true },
  })
  if (!token) return { ok: true as const } // idempotente
  if (token.userId !== user.id) {
    actionError('FORBIDDEN', 'No puedes eliminar tokens de otros usuarios')
  }

  await prisma.apiToken.delete({ where: { id: token.id } })
  revalidatePath('/settings/api')
  return { ok: true as const }
}

// ───────────────────────── Queries ─────────────────────────

export interface ApiTokenListItem {
  id: string
  name: string
  prefix: string
  scopes: string[]
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

/**
 * Lista los tokens del usuario autenticado. NO devuelve plaintext ni hash.
 */
export async function listApiTokensForUser(): Promise<ApiTokenListItem[]> {
  const user = await requireUser()
  const rows = await prisma.apiToken.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: (r.scopes as string[]) ?? [],
    expiresAt: r.expiresAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}
