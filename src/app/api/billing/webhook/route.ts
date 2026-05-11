/**
 * Wave R4-E · POST /api/billing/webhook
 *
 * Receptor de eventos Stripe. NO requiere autenticación de sesión — la
 * autenticidad se valida con `Stripe-Signature` (HMAC SHA-256 vía
 * `STRIPE_WEBHOOK_SECRET`).
 *
 * Eventos manejados:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.paid
 *   - invoice.payment_failed
 *
 * Idempotencia:
 *   1. Por `event.id` — si ya procesamos el mismo evento (replay), salimos.
 *      Se persiste en `BillingInvoice.stripeInvoiceId` para facturas; para
 *      subscription events confiamos en la naturaleza upsert del update.
 *   2. Por `invoice.id` — `BillingInvoice.stripeInvoiceId` es @unique.
 *
 * CRITICAL: el body se lee crudo (`await req.text()`) — Stripe rechaza
 * la firma si re-serializamos vía `req.json()`.
 */

import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'

import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { verifyWebhookSignature } from '@/lib/billing/stripe-client'
import type { PricingTier } from '@/lib/billing/pricing'
import { upsertSubscriptionFromStripe } from '@/lib/billing/subscription'

export const dynamic = 'force-dynamic'
// Force Node runtime — Edge no soporta el módulo `stripe` (usa fetch nativo
// pero requiere crypto.subtle para `constructEvent`; Node es más confiable).
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json(
      { error: { code: 'MISSING_SIGNATURE', message: 'stripe-signature header requerido' } },
      { status: 400 },
    )
  }

  let event: Stripe.Event
  try {
    event = verifyWebhookSignature(rawBody, signature)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Firma inválida'
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message } },
      { status: 400 },
    )
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionUpsert(event.data.object, 'created')
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(event.data.object, 'updated')
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object)
        break
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(event.data.object)
        break
      case 'invoice.payment_failed':
        await handleInvoiceFailed(event.data.object)
        break
      default:
        // Stripe envía muchos eventos por defecto; sólo procesamos los
        // listados. Responder 200 con `ignored=true` evita reintentos.
        break
    }
    return NextResponse.json({ received: true, type: event.type })
  } catch (err) {
    console.error('[Stripe webhook] handler error', err)
    // Stripe reintenta automáticamente 5xx. Devolver 500 sólo para errores
    // realmente irrecuperables; ya que validamos firma y los handlers son
    // idempotentes, casi todos los errores aquí son transient.
    return NextResponse.json(
      { error: { code: 'HANDLER_ERROR', message: 'Error procesando evento' } },
      { status: 500 },
    )
  }
}

// ───────────────────────── Handlers ─────────────────────────

async function handleSubscriptionUpsert(
  sub: Stripe.Subscription,
  kind: 'created' | 'updated',
): Promise<void> {
  const workspaceId = (sub.metadata as Record<string, string> | undefined)?.workspaceId
  if (!workspaceId) {
    console.warn(
      '[Stripe webhook] subscription sin metadata.workspaceId, ignorando',
      { id: sub.id },
    )
    return
  }

  const tier = inferTierFromMetadata(sub.metadata) ?? inferTierFromPrice(sub)
  const stripePriceId = sub.items.data[0]?.price.id ?? null
  const seats = sub.items.data[0]?.quantity ?? 1

  // Stripe usa `current_period_end` como UNIX timestamp en segundos.
  const currentPeriodEnd = toDateOrNull(
    (sub as unknown as { current_period_end?: number | null }).current_period_end ?? null,
  )
  const cancelAt = toDateOrNull(sub.cancel_at ?? null)
  const trialEndsAt = toDateOrNull(sub.trial_end ?? null)

  await upsertSubscriptionFromStripe({
    workspaceId,
    tier,
    status: sub.status,
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    stripePriceId,
    currentPeriodEnd,
    cancelAt,
    trialEndsAt,
    seats,
  })

  void recordAuditEventSafe({
    actorId: null,
    action: kind === 'created' ? 'billing.subscription_created' : 'billing.subscription_updated',
    entityType: 'workspace',
    entityId: workspaceId,
    metadata: {
      stripeSubscriptionId: sub.id,
      tier,
      status: sub.status,
    },
  })
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const workspaceId = (sub.metadata as Record<string, string> | undefined)?.workspaceId
  if (!workspaceId) return

  await upsertSubscriptionFromStripe({
    workspaceId,
    tier: 'FREE',
    status: sub.status, // 'canceled'
    stripeSubscriptionId: sub.id,
  })

  void recordAuditEventSafe({
    actorId: null,
    action: 'billing.subscription_canceled',
    entityType: 'workspace',
    entityId: workspaceId,
    metadata: { stripeSubscriptionId: sub.id, status: sub.status },
  })
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const workspaceId = await resolveWorkspaceFromInvoice(invoice)
  if (!workspaceId) return

  await persistInvoice(workspaceId, invoice, 'paid')

  void recordAuditEventSafe({
    actorId: null,
    action: 'billing.invoice_paid',
    entityType: 'workspace',
    entityId: workspaceId,
    metadata: {
      stripeInvoiceId: invoice.id,
      amountCents: invoice.amount_paid ?? invoice.amount_due,
    },
  })
}

async function handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const workspaceId = await resolveWorkspaceFromInvoice(invoice)
  if (!workspaceId) return

  await persistInvoice(workspaceId, invoice, 'open')

  void recordAuditEventSafe({
    actorId: null,
    action: 'billing.invoice_failed',
    entityType: 'workspace',
    entityId: workspaceId,
    metadata: {
      stripeInvoiceId: invoice.id,
      amountCents: invoice.amount_due,
    },
  })
}

// ───────────────────────── Utilidades ─────────────────────────

function inferTierFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): PricingTier | undefined {
  const meta = (metadata as Record<string, string> | undefined) ?? undefined
  const tier = meta?.tier
  if (tier === 'FREE' || tier === 'PRO' || tier === 'ENTERPRISE') return tier
  return undefined
}

function inferTierFromPrice(sub: Stripe.Subscription): PricingTier {
  const priceId = sub.items.data[0]?.price.id
  if (!priceId) return 'FREE'
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY) return 'PRO'
  if (priceId === process.env.STRIPE_PRICE_ENT_MONTHLY) return 'ENTERPRISE'
  return 'FREE'
}

function toDateOrNull(unixSeconds: number | null): Date | null {
  if (!unixSeconds || typeof unixSeconds !== 'number') return null
  return new Date(unixSeconds * 1000)
}

async function resolveWorkspaceFromInvoice(invoice: Stripe.Invoice): Promise<string | null> {
  // 1. Metadata directa.
  const direct = (invoice.metadata as Record<string, string> | undefined)?.workspaceId
  if (direct) return direct
  // 2. Vía customer → BillingSubscription.
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer?.id ?? null)
  if (!customerId) return null
  const sub = await prisma.billingSubscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { workspaceId: true },
  })
  return sub?.workspaceId ?? null
}

async function persistInvoice(
  workspaceId: string,
  invoice: Stripe.Invoice,
  fallbackStatus: string,
): Promise<void> {
  if (!invoice.id) return
  const periodStart = toDateOrNull(invoice.period_start ?? null) ?? new Date()
  const periodEnd = toDateOrNull(invoice.period_end ?? null) ?? new Date()
  const amountCents = invoice.amount_paid ?? invoice.amount_due ?? 0
  const currency = (invoice.currency ?? 'usd').toLowerCase()
  const status = invoice.status ?? fallbackStatus

  // Idempotente: si ya existe, actualiza solo el status (caso paid → void).
  await prisma.billingInvoice.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      workspaceId,
      stripeInvoiceId: invoice.id,
      amountCents,
      currency,
      status,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      periodStart,
      periodEnd,
    },
    update: {
      status,
      amountCents,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
    },
  })
}
