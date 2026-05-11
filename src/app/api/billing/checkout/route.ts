/**
 * Wave R4-E · POST /api/billing/checkout
 *
 * Crea una Stripe Checkout Session para upgradear el workspace al tier
 * pedido. Sólo OWNER/ADMIN del workspace pueden iniciar checkouts.
 *
 * Body JSON:
 *   { workspaceId: string, tier: 'PRO' | 'ENTERPRISE', returnUrl?: string }
 *
 * Respuesta 200:
 *   { url: string, sessionId: string }
 *
 * Errores:
 *   - 401 [UNAUTHORIZED]
 *   - 403 [FORBIDDEN] si MEMBER simple
 *   - 400 [INVALID_INPUT] / [STRIPE_PRICE_NOT_CONFIGURED]
 *   - 503 [STRIPE_NOT_CONFIGURED]
 */

import 'server-only'
import { z } from 'zod'
import { NextResponse, type NextRequest } from 'next/server'

import prisma from '@/lib/prisma'
import { requireWorkspaceManager } from '@/lib/auth/check-workspace-access'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  createCheckoutSession,
  getOrCreateStripeCustomer,
} from '@/lib/billing/stripe-client'
import { getWorkspaceSubscription, upsertSubscriptionFromStripe } from '@/lib/billing/subscription'
import type { PricingTier } from '@/lib/billing/pricing'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  workspaceId: z.string().min(1),
  tier: z.enum(['PRO', 'ENTERPRISE']),
  returnUrl: z.string().url().optional(),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null)
    if (!json) {
      return errorResponse('INVALID_INPUT', 'Body JSON requerido', 400)
    }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return errorResponse(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        400,
      )
    }
    const { workspaceId, tier, returnUrl } = parsed.data

    const { user } = await requireWorkspaceManager(workspaceId)

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, slug: true },
    })
    if (!workspace) {
      return errorResponse('WORKSPACE_NOT_FOUND', 'Workspace inexistente', 404)
    }

    const existing = await getWorkspaceSubscription(workspaceId)

    // Idempotencia: get-or-create del Stripe Customer (clave para que un
    // mismo WS no acumule customers fantasma en Stripe).
    const customerId = await getOrCreateStripeCustomer({
      workspaceId,
      existingCustomerId: existing.stripeCustomerId,
      email: user.email,
      name: workspace.name,
    })

    // Persistimos el customerId aunque la sub aún no exista — permite que
    // el siguiente intento (si el usuario abandona checkout) reuse el customer.
    await upsertSubscriptionFromStripe({
      workspaceId,
      stripeCustomerId: customerId,
    })

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
    const baseReturn = returnUrl ?? `${appUrl}/settings/billing`
    const successUrl = `${baseReturn}?checkout=success&session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${baseReturn}?checkout=cancel`

    const session = await createCheckoutSession({
      workspaceId,
      customerId,
      tier: tier as PricingTier,
      successUrl,
      cancelUrl,
      seats: existing.seats > 0 ? existing.seats : 1,
    })

    // Audit log no-bloqueante.
    void recordAuditEventSafe({
      actorId: user.id,
      action: 'billing.checkout_started',
      entityType: 'workspace',
      entityId: workspaceId,
      metadata: { tier, sessionId: session.sessionId },
    })

    return NextResponse.json({ url: session.url, sessionId: session.sessionId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    const code = extractCode(message)
    const status =
      code === 'UNAUTHORIZED'
        ? 401
        : code === 'FORBIDDEN' || code === 'NOT_MEMBER'
          ? 403
          : code === 'WORKSPACE_NOT_FOUND'
            ? 404
            : code === 'STRIPE_NOT_CONFIGURED' || code === 'STRIPE_PRICE_NOT_CONFIGURED'
              ? 503
              : 400
    return errorResponse(code, message, status)
  }
}

function extractCode(message: string): string {
  const match = message.match(/^\[([A-Z_]+)\]/)
  return match ? match[1]! : 'INTERNAL_ERROR'
}
