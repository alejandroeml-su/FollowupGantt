/**
 * Wave R4-E · POST /api/billing/portal
 *
 * Crea una Stripe Billing Portal Session para gestionar la suscripción
 * (cambiar tarjeta, ver facturas, cancelar). Sólo OWNER/ADMIN.
 *
 * Body JSON:
 *   { workspaceId: string, returnUrl?: string }
 *
 * Respuesta 200:
 *   { url: string }
 */

import 'server-only'
import { z } from 'zod'
import { NextResponse, type NextRequest } from 'next/server'

import { requireWorkspaceManager } from '@/lib/auth/check-workspace-access'
import { createBillingPortalSession } from '@/lib/billing/stripe-client'
import { getWorkspaceSubscription } from '@/lib/billing/subscription'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  workspaceId: z.string().min(1),
  returnUrl: z.string().url().optional(),
})

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json().catch(() => null)
    if (!json) return errorResponse('INVALID_INPUT', 'Body JSON requerido', 400)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return errorResponse(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        400,
      )
    }
    const { workspaceId, returnUrl } = parsed.data

    await requireWorkspaceManager(workspaceId)

    const sub = await getWorkspaceSubscription(workspaceId)
    if (!sub.stripeCustomerId) {
      return errorResponse(
        'NO_STRIPE_CUSTOMER',
        'Este workspace aún no tiene una suscripción en Stripe; inicia checkout primero.',
        400,
      )
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
    const baseReturn = returnUrl ?? `${appUrl}/settings/billing`

    const { url } = await createBillingPortalSession({
      customerId: sub.stripeCustomerId,
      returnUrl: baseReturn,
    })

    return NextResponse.json({ url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    const code = extractCode(message)
    const status =
      code === 'UNAUTHORIZED'
        ? 401
        : code === 'FORBIDDEN' || code === 'NOT_MEMBER'
          ? 403
          : code === 'STRIPE_NOT_CONFIGURED'
            ? 503
            : 400
    return errorResponse(code, message, status)
  }
}

function extractCode(message: string): string {
  const match = message.match(/^\[([A-Z_]+)\]/)
  return match ? match[1]! : 'INTERNAL_ERROR'
}
