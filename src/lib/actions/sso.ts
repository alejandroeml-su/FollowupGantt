'use server'

/**
 * R3.0 · Fase 2 · SSO/SAML — Server actions del CRUD admin.
 *
 * Cubre:
 *   - createProvider  · alta + parseo opcional de metadata XML.
 *   - updateProvider  · edición (incluye toggle enabled).
 *   - deleteProvider  · borrado (cascade hace que SsoUserLink caigan).
 *   - testProvider    · valida que un blob XML metadata parsea OK y
 *                       devuelve los 3 campos clave para preview.
 *
 * Convenciones aplicadas:
 *   - `requireWorkspaceManager(workspaceId)` ANTES de leer/escribir.
 *   - Errores tipados `[CODE] detalle`.
 *   - Audit `sso.provider.{created,updated,deleted}` con
 *     `recordAuditEventSafe` (fire-and-forget).
 *   - `revalidatePath('/admin/sso')` tras mutaciones.
 *   - `'use server'` purity: helpers en módulos puros (saml.ts,
 *     mapping.ts, provisioning.ts).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireWorkspaceManager } from '@/lib/auth/check-workspace-access'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { parseSamlMetadata } from '@/lib/sso/saml'
import { parseAttributeMap } from '@/lib/sso/mapping'
import type { ParsedSamlMetadata, SsoAttributeMap } from '@/lib/sso/types'

// ───────────────────────── Schemas zod ─────────────────────────

const attributeMapSchema = z.object({
  email: z.string().trim().min(1),
  name: z.string().trim().optional(),
  groups: z.string().trim().optional(),
  roleMap: z
    .record(z.string(), z.enum(['OWNER', 'ADMIN', 'MEMBER']))
    .optional(),
})

const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  entityId: z.string().trim().min(1).max(500),
  ssoUrl: z.string().trim().url().max(1000),
  x509Cert: z.string().trim().min(1),
  attributeMap: attributeMapSchema,
  enabled: z.boolean().optional(),
})

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  entityId: z.string().trim().min(1).max(500).optional(),
  ssoUrl: z.string().trim().url().max(1000).optional(),
  x509Cert: z.string().trim().min(1).optional(),
  attributeMap: attributeMapSchema.optional(),
  enabled: z.boolean().optional(),
})

const deleteSchema = z.object({
  id: z.string().min(1),
})

// ───────────────────────── Helpers ─────────────────────────

function ssoActionError(code: string, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

async function getProviderOrThrow(id: string) {
  const row = await prisma.ssoProvider.findUnique({
    where: { id },
    select: { id: true, workspaceId: true, name: true },
  })
  if (!row) ssoActionError('NOT_FOUND', `provider ${id} no existe`)
  return row
}

// ───────────────────────── Actions ─────────────────────────

export async function createSsoProvider(input: {
  workspaceId: string
  name: string
  entityId: string
  ssoUrl: string
  x509Cert: string
  attributeMap: SsoAttributeMap
  enabled?: boolean
}) {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    ssoActionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data
  const { user } = await requireWorkspaceManager(data.workspaceId)
  // Normaliza attributeMap (defensa adicional contra payload externo).
  const safeMap = parseAttributeMap(data.attributeMap)

  let created
  try {
    created = await prisma.ssoProvider.create({
      data: {
        workspaceId: data.workspaceId,
        name: data.name,
        entityId: data.entityId,
        ssoUrl: data.ssoUrl,
        x509Cert: data.x509Cert.trim(),
        attributeMap: safeMap as unknown as object,
        enabled: data.enabled ?? true,
      },
      select: { id: true, name: true, entityId: true },
    })
  } catch (err) {
    const msg = (err as Error).message ?? ''
    if (msg.includes('Unique') && msg.includes('entityId')) {
      ssoActionError(
        'DUPLICATE_ENTITY_ID',
        'ya existe un provider con ese entityId en este workspace',
      )
    }
    ssoActionError('PERSIST_FAILED', msg)
  }

  await recordAuditEventSafe({
    action: 'sso.provider.created',
    entityType: 'sso_provider',
    entityId: created.id,
    actorId: user.id,
    after: { name: created.name, entityId: created.entityId },
  })

  revalidatePath('/admin/sso')
  return created
}

export async function updateSsoProvider(input: {
  id: string
  name?: string
  entityId?: string
  ssoUrl?: string
  x509Cert?: string
  attributeMap?: SsoAttributeMap
  enabled?: boolean
}) {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    ssoActionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data
  const before = await getProviderOrThrow(data.id)
  const { user } = await requireWorkspaceManager(before.workspaceId)

  const updateData: {
    name?: string
    entityId?: string
    ssoUrl?: string
    x509Cert?: string
    attributeMap?: object
    enabled?: boolean
  } = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.entityId !== undefined) updateData.entityId = data.entityId
  if (data.ssoUrl !== undefined) updateData.ssoUrl = data.ssoUrl
  if (data.x509Cert !== undefined) updateData.x509Cert = data.x509Cert.trim()
  if (data.attributeMap !== undefined) {
    updateData.attributeMap = parseAttributeMap(data.attributeMap) as unknown as object
  }
  if (data.enabled !== undefined) updateData.enabled = data.enabled

  const updated = await prisma.ssoProvider.update({
    where: { id: data.id },
    data: updateData,
    select: { id: true, name: true, entityId: true, enabled: true },
  })

  await recordAuditEventSafe({
    action: 'sso.provider.updated',
    entityType: 'sso_provider',
    entityId: updated.id,
    actorId: user.id,
    after: { name: updated.name, enabled: updated.enabled },
  })

  revalidatePath('/admin/sso')
  return updated
}

export async function deleteSsoProvider(input: { id: string }) {
  const parsed = deleteSchema.safeParse(input)
  if (!parsed.success) {
    ssoActionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const before = await getProviderOrThrow(parsed.data.id)
  const { user } = await requireWorkspaceManager(before.workspaceId)

  await prisma.ssoProvider.delete({ where: { id: parsed.data.id } })

  await recordAuditEventSafe({
    action: 'sso.provider.deleted',
    entityType: 'sso_provider',
    entityId: parsed.data.id,
    actorId: user.id,
    before: { name: before.name },
  })

  revalidatePath('/admin/sso')
  return { ok: true }
}

/**
 * Valida y parsea un XML metadata pegado por el admin. NO persiste —
 * devuelve los 3 campos extraídos para preview en el form.
 *
 * @throws `[INVALID_METADATA]` propagado desde `parseSamlMetadata`.
 */
export async function testSsoMetadata(input: {
  workspaceId: string
  xml: string
}): Promise<ParsedSamlMetadata> {
  if (!input.workspaceId) ssoActionError('INVALID_INPUT', 'workspaceId requerido')
  await requireWorkspaceManager(input.workspaceId)
  return parseSamlMetadata(input.xml)
}
