'use server'

/**
 * R3.0-F · Data Retention Policies — Server Actions.
 *
 * Operaciones expuestas (consumidas desde la UI `/admin/retention`):
 *   - updatePolicy        — cambia retainDays/enabled de una policy.
 *   - runPurgeNow         — dispara manualmente el engine para un workspace.
 *   - getPolicies         — lista las 4 policies (auto-seed si faltan).
 *   - getPurgeHistory     — últimas N runs de una policy (o las 10 globales
 *                           del workspace si no se pasa policy).
 *
 * Convenciones del repo:
 *   - 'use server' purity: SOLO exporta funciones async.
 *   - Errores tipados `[CODE] detalle`.
 *   - `requireWorkspaceManager` (OWNER/ADMIN del WS o admin global) — los
 *     MEMBER simples NO pueden tocar policies ni disparar purge manual.
 *   - Audit log con `recordAuditEventSafe` después de mutaciones.
 *   - revalidatePath('/admin/retention').
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { RetentionDomain } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireWorkspaceManager } from '@/lib/auth/check-workspace-access'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { ensureDefaultPolicies } from '@/lib/retention/defaults'
import { runPurgeForWorkspace } from '@/lib/retention/engine'

// ───────────────────────── Errores tipados ─────────────────────────

export type RetentionErrorCode =
  | 'INVALID_INPUT'
  | 'POLICY_NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'

function actionError(code: RetentionErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const DOMAIN_VALUES = [
  'AUDIT_LOG',
  'SESSION',
  'NOTIFICATION',
  'BRAIN_INSIGHT',
] as const satisfies readonly RetentionDomain[]

const updatePolicySchema = z.object({
  workspaceId: z.string().min(1),
  domain: z.enum(DOMAIN_VALUES),
  // retainDays: mínimo 1 (la UI exhibe slider 1..3650). Máximo 10 años.
  retainDays: z.number().int().min(1).max(3650).optional(),
  enabled: z.boolean().optional(),
})

const runPurgeNowSchema = z.object({
  workspaceId: z.string().min(1),
})

const getPurgeHistorySchema = z.object({
  workspaceId: z.string().min(1),
  domain: z.enum(DOMAIN_VALUES).optional(),
  limit: z.number().int().min(1).max(100).default(10),
})

const getPoliciesSchema = z.object({
  workspaceId: z.string().min(1),
})

// ───────────────────────── Tipos serializados ─────────────────────────

export type SerializedPolicy = {
  id: string
  workspaceId: string
  domain: RetentionDomain
  retainDays: number
  enabled: boolean
  lastPurgeAt: string | null
  lastPurgeCount: number
  updatedAt: string
}

export type SerializedPurgeRun = {
  id: string
  policyId: string
  domain: RetentionDomain
  startedAt: string
  completedAt: string | null
  deletedCount: number
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  errorMessage: string | null
}

// ───────────────────────── Actions ─────────────────────────

/**
 * Devuelve las 4 policies del workspace. Auto-siembra defaults si faltan
 * (workspaces creados antes de R3.0-F no las tendrán).
 */
export async function getPolicies(input: {
  workspaceId: string
}): Promise<SerializedPolicy[]> {
  const parsed = getPoliciesSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { workspaceId } = parsed.data

  // Requiere ser miembro del WS (o admin global). Para LEER las policies
  // basta con acceso normal — el manager solo se exige para mutar.
  await requireWorkspaceManager(workspaceId)

  await ensureDefaultPolicies(workspaceId).catch((err) => {
    console.error('[Retention] ensureDefaultPolicies (getPolicies) failed', err)
  })

  const rows = await prisma.retentionPolicy.findMany({
    where: { workspaceId },
    orderBy: { domain: 'asc' },
  })
  return rows.map((p) => ({
    id: p.id,
    workspaceId: p.workspaceId,
    domain: p.domain,
    retainDays: p.retainDays,
    enabled: p.enabled,
    lastPurgeAt: p.lastPurgeAt ? p.lastPurgeAt.toISOString() : null,
    lastPurgeCount: p.lastPurgeCount,
    updatedAt: p.updatedAt.toISOString(),
  }))
}

/**
 * Actualiza retainDays y/o enabled de una policy. Solo OWNER/ADMIN del WS
 * (o admin global) puede mutar. Audit log con before/after.
 *
 * @throws `[INVALID_INPUT]` si retainDays < 1 o > 3650 (validado por zod).
 * @throws `[POLICY_NOT_FOUND]` si la policy no existe en el workspace.
 */
export async function updatePolicy(input: {
  workspaceId: string
  domain: RetentionDomain
  retainDays?: number
  enabled?: boolean
}): Promise<SerializedPolicy> {
  const parsed = updatePolicySchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { workspaceId, domain, retainDays, enabled } = parsed.data

  const { user } = await requireWorkspaceManager(workspaceId)

  // Auto-seed: si la policy no existe aún (workspace pre-R3.0-F),
  // sembramos defaults antes de actualizar.
  await ensureDefaultPolicies(workspaceId).catch(() => undefined)

  const existing = await prisma.retentionPolicy.findUnique({
    where: { workspaceId_domain: { workspaceId, domain } },
  })
  if (!existing) {
    actionError(
      'POLICY_NOT_FOUND',
      `No existe policy ${domain} para workspace ${workspaceId}`,
    )
  }

  const updated = await prisma.retentionPolicy.update({
    where: { workspaceId_domain: { workspaceId, domain } },
    data: {
      ...(retainDays !== undefined ? { retainDays } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    },
  })

  await recordAuditEventSafe({
    action: 'retention.policy.updated',
    entityType: 'retention_policy',
    entityId: updated.id,
    actorId: user.id,
    before: {
      retainDays: existing.retainDays,
      enabled: existing.enabled,
    },
    after: {
      retainDays: updated.retainDays,
      enabled: updated.enabled,
    },
    metadata: { workspaceId, domain },
  })

  revalidatePath('/admin/retention')

  return {
    id: updated.id,
    workspaceId: updated.workspaceId,
    domain: updated.domain,
    retainDays: updated.retainDays,
    enabled: updated.enabled,
    lastPurgeAt: updated.lastPurgeAt
      ? updated.lastPurgeAt.toISOString()
      : null,
    lastPurgeCount: updated.lastPurgeCount,
    updatedAt: updated.updatedAt.toISOString(),
  }
}

/**
 * Dispara manualmente el engine de purge para un workspace. Solo
 * OWNER/ADMIN del workspace (o admin global).
 *
 * NOTA: operación destructiva. La UI debe pedir confirmación antes de
 * invocar (el componente cliente muestra dialog).
 */
export async function runPurgeNow(input: {
  workspaceId: string
}): Promise<{
  workspaceId: string
  outcomes: {
    domain: RetentionDomain
    status: 'SUCCESS' | 'FAILED'
    deletedCount: number
    errorMessage: string | null
  }[]
}> {
  const parsed = runPurgeNowSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { workspaceId } = parsed.data

  await requireWorkspaceManager(workspaceId)

  const report = await runPurgeForWorkspace(workspaceId)
  revalidatePath('/admin/retention')

  return {
    workspaceId: report.workspaceId,
    outcomes: report.outcomes.map((o) => ({
      domain: o.domain,
      status: o.status,
      deletedCount: o.deletedCount,
      errorMessage: o.errorMessage,
    })),
  }
}

/**
 * Lista las últimas N runs del workspace. Si `domain` se pasa, filtra
 * a esa policy. Default 10 más recientes.
 */
export async function getPurgeHistory(input: {
  workspaceId: string
  domain?: RetentionDomain
  limit?: number
}): Promise<SerializedPurgeRun[]> {
  const parsed = getPurgeHistorySchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { workspaceId, domain, limit } = parsed.data

  await requireWorkspaceManager(workspaceId)

  const runs = await prisma.retentionPurgeRun.findMany({
    where: {
      policy: {
        workspaceId,
        ...(domain ? { domain } : {}),
      },
    },
    include: { policy: { select: { domain: true } } },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })

  return runs.map((r) => ({
    id: r.id,
    policyId: r.policyId,
    domain: r.policy.domain,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    deletedCount: r.deletedCount,
    status: r.status,
    errorMessage: r.errorMessage,
  }))
}
