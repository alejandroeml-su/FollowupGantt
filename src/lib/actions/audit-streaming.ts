'use server'

/**
 * R3-E · Audit Streaming · Server Actions.
 *
 * CRUD del catálogo `AuditStreamTarget` + acciones operativas
 * (`testTarget`, `retryDelivery`). Todas requieren SUPER_ADMIN.
 *
 * Errores tipados `[CODE] detalle`:
 *   - INVALID_INPUT      · zod falló
 *   - NOT_FOUND          · target no existe
 *   - FORBIDDEN          · caller no es SUPER_ADMIN (delegado en helper)
 *   - PERSIST_FAILED     · Prisma rechazó la mutación
 *   - DELIVERY_FAILED    · `testTarget` recibió error del SIEM
 *   - INVALID_DELIVERY   · delivery no se puede reintentar
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { AuditStreamKind } from '@prisma/client'

import prisma from '@/lib/prisma'
import { requireSuperAdminOrThrow } from '@/lib/auth/check-super-admin'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { sendTestEvent } from '@/lib/audit/streaming/engine'

// ───────────────────────── Errores tipados ─────────────────────────

export type AuditStreamingErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PERSIST_FAILED'
  | 'DELIVERY_FAILED'
  | 'INVALID_DELIVERY'

function streamingError(code: AuditStreamingErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas zod ─────────────────────────

const KIND_VALUES = ['SPLUNK', 'DATADOG', 'GENERIC_WEBHOOK'] as const satisfies readonly AuditStreamKind[]

const endpointSchema = z
  .string()
  .trim()
  .url({ message: 'Endpoint debe ser una URL válida (https://...)' })
  .max(500)
  .refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), {
    message: 'Endpoint debe usar https:// (o http://localhost para dev)',
  })

const createTargetSchema = z.object({
  workspaceId: z.string().min(1),
  kind: z.enum(KIND_VALUES),
  endpoint: endpointSchema,
  secret: z.string().min(8, 'El secret debe tener al menos 8 caracteres').max(500),
  batchSize: z.number().int().min(1).max(1000).optional(),
  enabled: z.boolean().optional(),
})

const updateTargetSchema = z.object({
  id: z.string().min(1),
  endpoint: endpointSchema.optional(),
  secret: z.string().min(8).max(500).optional(),
  batchSize: z.number().int().min(1).max(1000).optional(),
  enabled: z.boolean().optional(),
})

const idOnlySchema = z.object({ id: z.string().min(1) })

// ───────────────────────── Helpers ─────────────────────────

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '***'
  return `${secret.slice(0, 4)}…${secret.slice(-2)}`
}

// ───────────────────────── createTarget ─────────────────────────

export async function createAuditStreamTarget(
  input: z.input<typeof createTargetSchema>,
) {
  const user = await requireSuperAdminOrThrow({ path: '/admin/audit-streaming' })
  const parsed = createTargetSchema.safeParse(input)
  if (!parsed.success) {
    streamingError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  try {
    const created = await prisma.auditStreamTarget.create({
      data: {
        workspaceId: data.workspaceId,
        kind: data.kind,
        endpoint: data.endpoint,
        secret: data.secret,
        batchSize: data.batchSize ?? 100,
        enabled: data.enabled ?? true,
      },
      select: {
        id: true,
        workspaceId: true,
        kind: true,
        endpoint: true,
        batchSize: true,
        enabled: true,
        createdAt: true,
      },
    })

    void recordAuditEventSafe({
      actorId: user.id,
      action: 'audit_stream.target_created',
      entityType: 'audit_stream_target',
      entityId: created.id,
      after: {
        workspaceId: created.workspaceId,
        kind: created.kind,
        endpoint: created.endpoint,
        batchSize: created.batchSize,
        enabled: created.enabled,
        secret: maskSecret(data.secret),
      },
      metadata: { module: 'audit-streaming' },
    })

    revalidatePath('/admin/audit-streaming')
    return { ...created, createdAt: created.createdAt.toISOString() }
  } catch (err) {
    streamingError('PERSIST_FAILED', err instanceof Error ? err.message : String(err))
  }
}

// ───────────────────────── updateTarget ─────────────────────────

export async function updateAuditStreamTarget(
  input: z.input<typeof updateTargetSchema>,
) {
  const user = await requireSuperAdminOrThrow({ path: '/admin/audit-streaming' })
  const parsed = updateTargetSchema.safeParse(input)
  if (!parsed.success) {
    streamingError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  const existing = await prisma.auditStreamTarget.findUnique({
    where: { id: data.id },
  })
  if (!existing) streamingError('NOT_FOUND', `Target ${data.id} no encontrado`)

  try {
    const updated = await prisma.auditStreamTarget.update({
      where: { id: data.id },
      data: {
        endpoint: data.endpoint ?? undefined,
        secret: data.secret ?? undefined,
        batchSize: data.batchSize ?? undefined,
        enabled: data.enabled ?? undefined,
      },
      select: {
        id: true,
        workspaceId: true,
        kind: true,
        endpoint: true,
        batchSize: true,
        enabled: true,
        updatedAt: true,
      },
    })

    void recordAuditEventSafe({
      actorId: user.id,
      action: 'audit_stream.target_updated',
      entityType: 'audit_stream_target',
      entityId: updated.id,
      before: {
        endpoint: existing.endpoint,
        batchSize: existing.batchSize,
        enabled: existing.enabled,
      },
      after: {
        endpoint: updated.endpoint,
        batchSize: updated.batchSize,
        enabled: updated.enabled,
        ...(data.secret ? { secret: maskSecret(data.secret) } : {}),
      },
      metadata: { module: 'audit-streaming' },
    })

    revalidatePath('/admin/audit-streaming')
    return { ...updated, updatedAt: updated.updatedAt.toISOString() }
  } catch (err) {
    streamingError('PERSIST_FAILED', err instanceof Error ? err.message : String(err))
  }
}

// ───────────────────────── deleteTarget ─────────────────────────

export async function deleteAuditStreamTarget(
  input: z.input<typeof idOnlySchema>,
) {
  const user = await requireSuperAdminOrThrow({ path: '/admin/audit-streaming' })
  const parsed = idOnlySchema.safeParse(input)
  if (!parsed.success) streamingError('INVALID_INPUT', 'id requerido')

  const existing = await prisma.auditStreamTarget.findUnique({
    where: { id: parsed.data.id },
  })
  if (!existing) streamingError('NOT_FOUND', `Target ${parsed.data.id} no encontrado`)

  try {
    await prisma.auditStreamTarget.delete({ where: { id: parsed.data.id } })

    void recordAuditEventSafe({
      actorId: user.id,
      action: 'audit_stream.target_deleted',
      entityType: 'audit_stream_target',
      entityId: parsed.data.id,
      before: {
        workspaceId: existing.workspaceId,
        kind: existing.kind,
        endpoint: existing.endpoint,
      },
      metadata: { module: 'audit-streaming' },
    })

    revalidatePath('/admin/audit-streaming')
    return { ok: true }
  } catch (err) {
    streamingError('PERSIST_FAILED', err instanceof Error ? err.message : String(err))
  }
}

// ───────────────────────── testTarget ─────────────────────────

export async function testAuditStreamTarget(
  input: z.input<typeof idOnlySchema>,
) {
  const user = await requireSuperAdminOrThrow({ path: '/admin/audit-streaming' })
  const parsed = idOnlySchema.safeParse(input)
  if (!parsed.success) streamingError('INVALID_INPUT', 'id requerido')

  const target = await prisma.auditStreamTarget.findUnique({
    where: { id: parsed.data.id },
  })
  if (!target) streamingError('NOT_FOUND', `Target ${parsed.data.id} no encontrado`)

  const result = await sendTestEvent({
    id: target.id,
    workspaceId: target.workspaceId,
    kind: target.kind,
    endpoint: target.endpoint,
    secret: target.secret,
  })

  void recordAuditEventSafe({
    actorId: user.id,
    action: 'audit_stream.target_tested',
    entityType: 'audit_stream_target',
    entityId: target.id,
    metadata: {
      module: 'audit-streaming',
      ok: result.ok,
      error: result.ok ? null : result.error,
    },
  })

  if (!result.ok) {
    streamingError('DELIVERY_FAILED', result.error ?? 'Adapter devolvió !ok')
  }
  return { ok: true }
}

// ───────────────────────── retryDelivery ─────────────────────────

export async function retryAuditStreamDelivery(
  input: z.input<typeof idOnlySchema>,
) {
  const user = await requireSuperAdminOrThrow({ path: '/admin/audit-streaming' })
  const parsed = idOnlySchema.safeParse(input)
  if (!parsed.success) streamingError('INVALID_INPUT', 'id requerido')

  const delivery = await prisma.auditStreamDelivery.findUnique({
    where: { id: parsed.data.id },
  })
  if (!delivery) streamingError('NOT_FOUND', `Delivery ${parsed.data.id} no encontrado`)
  if (delivery.status === 'SUCCESS') {
    streamingError('INVALID_DELIVERY', 'Delivery ya está en SUCCESS')
  }

  await prisma.auditStreamDelivery.update({
    where: { id: delivery.id },
    data: {
      status: 'RETRYING',
      attempt: 0,
      lastError: null,
    },
  })

  void recordAuditEventSafe({
    actorId: user.id,
    action: 'audit_stream.delivery_retried',
    entityType: 'audit_stream_delivery',
    entityId: delivery.id,
    metadata: { module: 'audit-streaming' },
  })

  revalidatePath('/admin/audit-streaming')
  return { ok: true }
}

// ───────────────────────── listTargets (read) ─────────────────────────

export async function listAuditStreamTargets(workspaceId?: string) {
  await requireSuperAdminOrThrow({ path: '/admin/audit-streaming' })
  const targets = await prisma.auditStreamTarget.findMany({
    where: workspaceId ? { workspaceId } : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      workspaceId: true,
      kind: true,
      endpoint: true,
      batchSize: true,
      enabled: true,
      lastDeliveryAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return targets.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    lastDeliveryAt: t.lastDeliveryAt ? t.lastDeliveryAt.toISOString() : null,
  }))
}
