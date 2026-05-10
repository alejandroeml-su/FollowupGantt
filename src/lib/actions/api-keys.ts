'use server'

/**
 * Wave P17-B · Server actions de API Keys (workspace-scoped).
 *
 * Convenciones:
 *   - Usuario debe estar autenticado y ser miembro del workspace activo.
 *   - El plaintext SÓLO se devuelve en `createApiKey` (UNA vez); la lista
 *     y revoke nunca lo exponen.
 *   - Errores tipados `[CODE] detalle` (`INVALID_INPUT`, `INVALID_SCOPES`,
 *     `NOT_FOUND`, `FORBIDDEN`, `WORKSPACE_REQUIRED`).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { generateApiKey } from '@/lib/api/v2-auth'
import { validateV2Scopes, KNOWN_V2_SCOPES } from '@/lib/api/v2-scopes'
import { getActiveWorkspaceId } from '@/lib/actions/workspaces'
import { getDefaultWorkspaceForUser } from '@/lib/auth/check-workspace-access'

export type ApiKeyErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SCOPES'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'WORKSPACE_REQUIRED'

function actionError(code: ApiKeyErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

const NAME_MAX = 120

const createSchema = z.object({
  name: z.string().min(1).max(NAME_MAX),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.string().datetime().optional().nullable(),
})

export type CreateApiKeyInput = z.input<typeof createSchema>

const idSchema = z.object({ id: z.string().min(1) })

/**
 * Resuelve el workspace activo (cookie). Si no existe, cae al "personal"
 * por defecto del usuario (idéntico patrón al resto del repo). Garantiza
 * que el caller tenga al menos un workspace para issuing de keys.
 */
async function resolveWorkspaceId(userId: string): Promise<string> {
  const active = await getActiveWorkspaceId()
  if (active) return active
  const fallback = await getDefaultWorkspaceForUser(userId)
  return fallback.id
}

/**
 * Crea una API key v2 y devuelve el plaintext UNA SOLA VEZ.
 */
export async function createApiKey(input: CreateApiKeyInput): Promise<{
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

  const validated = validateV2Scopes(rawScopes)
  if (validated.length === 0) {
    actionError(
      'INVALID_SCOPES',
      `Scopes no reconocidos. Válidos: ${KNOWN_V2_SCOPES.join(', ')}`,
    )
  }

  const workspaceId = await resolveWorkspaceId(user.id)
  const { plaintext, hashedKey, prefix } = generateApiKey()

  const created = await prisma.apiKey.create({
    data: {
      name: name.trim(),
      prefix,
      hashedKey,
      scopes: validated,
      workspaceId,
      createdById: user.id,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    select: { id: true, prefix: true, scopes: true },
  })

  revalidatePath('/settings/api-keys')

  return {
    id: created.id,
    plaintext,
    prefix: created.prefix,
    scopes: created.scopes,
  }
}

/**
 * Marca una API key como revocada. La auth de v2 falla inmediatamente para
 * keys revocadas. Idempotente.
 */
export async function revokeApiKey(input: { id: string }): Promise<{ ok: true }> {
  const user = await requireUser()
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', 'id requerido')

  const workspaceId = await resolveWorkspaceId(user.id)
  const key = await prisma.apiKey.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, workspaceId: true, revokedAt: true },
  })
  if (!key) actionError('NOT_FOUND', 'API key no encontrada')
  if (key.workspaceId !== workspaceId) {
    actionError('FORBIDDEN', 'No puedes revocar keys de otro workspace')
  }

  if (!key.revokedAt) {
    await prisma.apiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    })
  }

  revalidatePath('/settings/api-keys')
  return { ok: true as const }
}

/**
 * Elimina permanentemente la API key (vs revoke, que mantiene el row para
 * auditoría). Útil para "limpiar" keys nunca usadas.
 */
export async function deleteApiKey(input: { id: string }): Promise<{ ok: true }> {
  const user = await requireUser()
  const parsed = idSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', 'id requerido')

  const workspaceId = await resolveWorkspaceId(user.id)
  const key = await prisma.apiKey.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, workspaceId: true },
  })
  if (!key) return { ok: true as const }
  if (key.workspaceId !== workspaceId) {
    actionError('FORBIDDEN', 'No puedes eliminar keys de otro workspace')
  }

  await prisma.apiKey.delete({ where: { id: key.id } })
  revalidatePath('/settings/api-keys')
  return { ok: true as const }
}

export interface ApiKeyListItem {
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
 * Lista las API keys del workspace activo. NO devuelve plaintext ni hash.
 */
export async function listApiKeys(): Promise<ApiKeyListItem[]> {
  const user = await requireUser()
  const workspaceId = await resolveWorkspaceId(user.id)

  const rows = await prisma.apiKey.findMany({
    where: { workspaceId },
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
    scopes: r.scopes,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}
