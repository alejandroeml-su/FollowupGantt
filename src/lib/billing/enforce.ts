import 'server-only'

import prisma from '@/lib/prisma'

import {
  type CapacityResource,
  PRICING_TIERS,
  type PricingTier,
  tierAllowsCapacity,
  tierIncludesFeature,
} from './pricing'
import { getWorkspaceSubscription } from './subscription'

/**
 * Wave R4-E · Plan enforcement middleware.
 *
 * API minimalista para server actions críticos:
 *
 *   await requireFeature(workspaceId, 'evm')          // throws [FEATURE_NOT_AVAILABLE]
 *   await requireCapacity(workspaceId, 'projects', n) // throws [CAPACITY_EXCEEDED]
 *
 * Convenciones (no negociables):
 *   - Workspaces sin BillingSubscription → tier FREE.
 *   - Status no-activo (past_due, canceled, …) → demota a FREE *para
 *     features*; las capacidades existentes siguen accesibles (no-disruptive).
 *   - Errores tipados `[CODE] detalle` consistentes con el resto del repo.
 */

export type BillingErrorCode =
  | 'FEATURE_NOT_AVAILABLE'
  | 'CAPACITY_EXCEEDED'
  | 'INVALID_INPUT'

function billingError(code: BillingErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

/**
 * Devuelve `{ tier, isActive }` con la lógica de degradación lógica:
 *   - status activo → tier real.
 *   - status no-activo → 'FREE' (para feature gates).
 *
 * Las capacidades (users/projects/storage) se evalúan contra el tier
 * "comprado" aunque esté past_due — la idea es no bloquear nuevas acciones
 * por un fallo temporal de pago (UX). El banner del UI debe alertar.
 */
async function effectiveTier(workspaceId: string): Promise<{
  tier: PricingTier
  isActive: boolean
  raw: PricingTier
}> {
  const sub = await getWorkspaceSubscription(workspaceId)
  return {
    tier: sub.isActive ? sub.tier : 'FREE',
    isActive: sub.isActive,
    raw: sub.tier,
  }
}

/**
 * Valida que el tier vigente del workspace incluya `feature`. Throws
 * `[FEATURE_NOT_AVAILABLE]` con detalle del tier requerido si no.
 *
 * @example
 *   await requireFeature(workspaceId, 'monte_carlo')
 */
export async function requireFeature(
  workspaceId: string,
  feature: string,
): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    billingError('INVALID_INPUT', 'workspaceId requerido')
  }
  if (!feature || typeof feature !== 'string') {
    billingError('INVALID_INPUT', 'feature requerida')
  }
  const { tier } = await effectiveTier(workspaceId)
  if (!tierIncludesFeature(tier, feature)) {
    const minTier = inferMinTierForFeature(feature)
    billingError(
      'FEATURE_NOT_AVAILABLE',
      `La feature "${feature}" requiere plan ${minTier} o superior (actual: ${tier})`,
    )
  }
}

/**
 * Valida que el tier permita añadir 1 recurso más del tipo dado. Throws
 * `[CAPACITY_EXCEEDED]` si `current >= límite`.
 *
 * Para `users` y `projects`: el caller calcula el count actual y lo pasa.
 * Para `brainCalls`: el caller pasa `brainCallsThisMonth` previo al increment.
 *
 * @example
 *   const count = await prisma.project.count({ where: { workspaceId } })
 *   await requireCapacity(workspaceId, 'projects', count)
 *   await prisma.project.create({ … })
 */
export async function requireCapacity(
  workspaceId: string,
  resource: CapacityResource,
  current: number,
): Promise<void> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    billingError('INVALID_INPUT', 'workspaceId requerido')
  }
  if (typeof current !== 'number' || Number.isNaN(current) || current < 0) {
    billingError('INVALID_INPUT', `current inválido (recibido: ${current})`)
  }
  // Capacidad se evalúa contra el tier "raw" (no degradado) para no bloquear
  // operativa si la tarjeta está past_due 24h — el banner del UI alerta.
  const { raw } = await effectiveTier(workspaceId)
  if (!tierAllowsCapacity(raw, resource, current)) {
    const max = PRICING_TIERS[raw][resource]
    billingError(
      'CAPACITY_EXCEEDED',
      `Tu plan ${raw} permite hasta ${max === -1 ? '∞' : max} ${resource} (actual: ${current})`,
    )
  }
}

/**
 * Helper de conveniencia: cuenta proyectos del workspace y aplica enforce.
 * Centraliza la lectura para que los callers no dupliquen la query.
 */
export async function requireProjectCapacity(workspaceId: string): Promise<void> {
  const count = await prisma.project.count({ where: { workspaceId } })
  await requireCapacity(workspaceId, 'projects', count)
}

/**
 * Helper de conveniencia: cuenta miembros del workspace + invitaciones
 * pendientes (las pendientes "reservan" un asiento — UX consistente).
 */
export async function requireMemberCapacity(workspaceId: string): Promise<void> {
  const [members, pendingInvites] = await Promise.all([
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.workspaceInvitation.count({
      where: { workspaceId, expiresAt: { gt: new Date() } },
    }),
  ])
  await requireCapacity(workspaceId, 'users', members + pendingInvites)
}

/**
 * Helper de conveniencia: lee `brainCallsThisMonth` del workspace y aplica
 * enforce. Si la columna no existe (preview sin migración), devuelve sin
 * romper para no bloquear el Brain (deuda visible vía logs).
 */
export async function requireBrainCapacity(workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { brainCallsThisMonth: true },
  })
  if (!ws) return
  await requireCapacity(workspaceId, 'brainCalls', ws.brainCallsThisMonth ?? 0)
}

/**
 * Heurística para sugerir el tier mínimo que incluye una feature. Recorre
 * `PRICING_TIERS` en orden y devuelve el primero que la incluye. Si nadie
 * la tiene (typo del caller), devuelve 'ENTERPRISE' como default seguro.
 */
function inferMinTierForFeature(feature: string): PricingTier {
  const order: PricingTier[] = ['FREE', 'PRO', 'ENTERPRISE']
  for (const tier of order) {
    if (tierIncludesFeature(tier, feature)) return tier
  }
  return 'ENTERPRISE'
}
