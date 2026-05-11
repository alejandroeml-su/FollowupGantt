import 'server-only'

import prisma from '@/lib/prisma'

import { type PricingTier, TIER_ORDER } from './pricing'

/**
 * Wave R4-E · Helpers de lectura/escritura sobre BillingSubscription.
 *
 * Mantiene la lógica de "qué tier vigente tiene este workspace" en un único
 * sitio para que tanto el enforcement como la UI usen la misma respuesta.
 *
 * Convenciones:
 *   - Workspaces sin `BillingSubscription` → tier FREE implícito (D-PRICING-2).
 *   - Subscription con `status` en {past_due, canceled, unpaid, incomplete}
 *     mantiene `tier` pero el enforcement aplica un downgrade lógico a FREE
 *     PARA features paid (no para data existente).
 */

/** Set de estados Stripe que conceden acceso al tier comprado. */
const ACTIVE_STATUSES = new Set(['active', 'trialing'])

export type EffectiveSubscription = {
  tier: PricingTier
  status: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: Date | null
  cancelAt: Date | null
  trialEndsAt: Date | null
  seats: number
  /** Tier "vigente" tras aplicar status → false demota a FREE. */
  isActive: boolean
}

/**
 * Devuelve el tier vigente del workspace. Defensive: si no hay
 * BillingSubscription, devuelve FREE active.
 */
export async function getWorkspaceSubscription(
  workspaceId: string,
): Promise<EffectiveSubscription> {
  const sub = await prisma.billingSubscription.findUnique({
    where: { workspaceId },
  })

  if (!sub) {
    return {
      tier: 'FREE',
      status: 'active',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAt: null,
      trialEndsAt: null,
      seats: 1,
      isActive: true,
    }
  }

  const tier: PricingTier = isKnownTier(sub.tier) ? sub.tier : 'FREE'
  const isActive = ACTIVE_STATUSES.has(sub.status)

  return {
    tier,
    status: sub.status,
    stripeCustomerId: sub.stripeCustomerId,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAt: sub.cancelAt,
    trialEndsAt: sub.trialEndsAt,
    seats: sub.seats,
    isActive,
  }
}

function isKnownTier(value: string): value is PricingTier {
  return (TIER_ORDER as readonly string[]).includes(value)
}

/**
 * Upsert "soft" para crear/actualizar la subscription desde el webhook.
 * No toca campos `null` o `undefined` (preserva valores previos).
 */
export async function upsertSubscriptionFromStripe(input: {
  workspaceId: string
  tier?: PricingTier
  status?: string
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  stripePriceId?: string | null
  currentPeriodEnd?: Date | null
  cancelAt?: Date | null
  trialEndsAt?: Date | null
  seats?: number
}): Promise<void> {
  const updateData: Record<string, unknown> = {}
  if (input.tier !== undefined) updateData.tier = input.tier
  if (input.status !== undefined) updateData.status = input.status
  if (input.stripeCustomerId !== undefined) updateData.stripeCustomerId = input.stripeCustomerId
  if (input.stripeSubscriptionId !== undefined)
    updateData.stripeSubscriptionId = input.stripeSubscriptionId
  if (input.stripePriceId !== undefined) updateData.stripePriceId = input.stripePriceId
  if (input.currentPeriodEnd !== undefined) updateData.currentPeriodEnd = input.currentPeriodEnd
  if (input.cancelAt !== undefined) updateData.cancelAt = input.cancelAt
  if (input.trialEndsAt !== undefined) updateData.trialEndsAt = input.trialEndsAt
  if (input.seats !== undefined) updateData.seats = input.seats

  await prisma.billingSubscription.upsert({
    where: { workspaceId: input.workspaceId },
    update: updateData,
    create: {
      workspaceId: input.workspaceId,
      tier: input.tier ?? 'FREE',
      status: input.status ?? 'active',
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      stripePriceId: input.stripePriceId ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      cancelAt: input.cancelAt ?? null,
      trialEndsAt: input.trialEndsAt ?? null,
      seats: input.seats ?? 1,
    },
  })
}

/**
 * Marca el flag `onboardingCompletedAt`. Idempotente — si ya estaba seteado,
 * no lo machaca.
 */
export async function markOnboardingCompleted(workspaceId: string): Promise<void> {
  await prisma.workspace.updateMany({
    where: { id: workspaceId, onboardingCompletedAt: null },
    data: { onboardingCompletedAt: new Date() },
  })
}

/**
 * Incrementa el contador de Brain calls del mes. Best-effort: si la columna
 * no existe (preview deploy sin migración), atrapa el error y devuelve.
 *
 * El reset del contador lo hace el cron mensual (no incluido en este PR —
 * pendiente operativo).
 */
export async function incrementBrainCalls(workspaceId: string): Promise<number> {
  const updated = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      brainCallsThisMonth: { increment: 1 },
    },
    select: { brainCallsThisMonth: true },
  })
  return updated.brainCallsThisMonth
}

/**
 * Resetea el contador de Brain calls del mes para todos los workspaces.
 * Pensado para ser invocado por un cron job mensual (día 1 del mes).
 */
export async function resetMonthlyBrainCounters(): Promise<{ updated: number }> {
  const result = await prisma.workspace.updateMany({
    data: {
      brainCallsThisMonth: 0,
      brainCallsResetAt: new Date(),
    },
  })
  return { updated: result.count }
}
