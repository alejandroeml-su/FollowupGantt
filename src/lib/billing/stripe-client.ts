import 'server-only'
import Stripe from 'stripe'

import { getStripePriceIdForTier, type PricingTier } from './pricing'

/**
 * Wave R4-E · Stripe SDK wrapper (server-only).
 *
 * Inicialización lazy + singleton: el constructor lanza si `STRIPE_SECRET_KEY`
 * no está seteado, pero diferimos el error al primer uso para que `next build`
 * no rompa cuando la env var no está inyectada (mismo patrón que prisma.ts).
 *
 * Decisiones documentadas:
 *   D-STRIPE-1: `apiVersion` lock para evitar drift silencioso. Cuando se
 *               actualice el SDK, regenerar tipos + verificar el changelog
 *               de Stripe (https://stripe.com/docs/upgrades).
 *   D-STRIPE-2: `typescript: true` da tipos exhaustivos sobre `Stripe.*`.
 *   D-STRIPE-3: Los helpers devuelven `null` en lugar de lanzar si la env
 *               está ausente — la UI los presenta como "Billing deshabilitado"
 *               (modo dev local sin Stripe).
 */

let cachedStripe: Stripe | null = null

export function getStripeClient(): Stripe | null {
  if (cachedStripe) return cachedStripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  cachedStripe = new Stripe(key, {
    // D-STRIPE-1: Pin de versión. Stripe rota cada 6 meses; revisar el
    // changelog antes de subir. Usamos la versión que el SDK tipa
    // (`Stripe.LatestApiVersion`) para evitar drift entre SDK y backend.
    apiVersion: '2026-04-22.dahlia',
    typescript: true,
  })
  return cachedStripe
}

/**
 * Lanza si Stripe no está configurado. Útil para route handlers donde
 * preferimos 503 explícito antes que un null silente.
 */
export function requireStripeClient(): Stripe {
  const stripe = getStripeClient()
  if (!stripe) {
    throw new Error(
      '[STRIPE_NOT_CONFIGURED] STRIPE_SECRET_KEY env var requerida para billing',
    )
  }
  return stripe
}

/**
 * Crea (o reusa) un Stripe Customer para el workspace. Idempotente: si la
 * `BillingSubscription` ya tiene `stripeCustomerId`, lo devuelve sin tocar
 * Stripe. Si no, crea un Customer con `metadata.workspaceId` para que el
 * webhook pueda mapear de vuelta sin ambigüedad.
 *
 * @param workspaceId  Workspace ID (single source of truth para tenant).
 * @param email        Email del usuario que dispara el checkout (para que
 *                     Stripe lo pre-llene en el dashboard).
 * @param name         Nombre del workspace (mostrado en facturas/dashboard).
 */
export async function getOrCreateStripeCustomer(input: {
  workspaceId: string
  existingCustomerId?: string | null
  email: string
  name: string
}): Promise<string> {
  const stripe = requireStripeClient()

  // Si ya tenemos un customer ID, validamos que siga existiendo en Stripe
  // (no relanzamos si fue borrado manualmente — creamos uno nuevo).
  if (input.existingCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(input.existingCustomerId)
      if (!existing.deleted) return input.existingCustomerId
    } catch {
      // Cae a creación nueva si el customer no existe.
    }
  }

  const customer = await stripe.customers.create({
    email: input.email,
    name: input.name,
    metadata: {
      workspaceId: input.workspaceId,
    },
  })
  return customer.id
}

/**
 * Crea una Checkout Session para upgradear el workspace al tier dado.
 * Modo `subscription` con `price` pre-seteado por env var. El returnUrl
 * recibe `?session_id={CHECKOUT_SESSION_ID}` para que la página de éxito
 * pueda mostrar feedback inmediato (el state real lo persiste el webhook).
 *
 * Throws `[STRIPE_PRICE_NOT_CONFIGURED]` si el env var del price está vacío.
 */
export async function createCheckoutSession(input: {
  workspaceId: string
  customerId: string
  tier: PricingTier
  successUrl: string
  cancelUrl: string
  seats?: number
}): Promise<{ url: string; sessionId: string }> {
  const stripe = requireStripeClient()
  const priceId = getStripePriceIdForTier(input.tier)
  if (!priceId) {
    throw new Error(
      `[STRIPE_PRICE_NOT_CONFIGURED] No hay Stripe Price ID para tier ${input.tier}`,
    )
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: input.customerId,
    line_items: [
      {
        price: priceId,
        quantity: Math.max(1, input.seats ?? 1),
      },
    ],
    // El webhook usa estos metadatos para mapear back a Workspace al
    // recibir `customer.subscription.created`.
    subscription_data: {
      metadata: {
        workspaceId: input.workspaceId,
        tier: input.tier,
      },
    },
    metadata: {
      workspaceId: input.workspaceId,
      tier: input.tier,
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // Habilita estimación de impuestos automática si el merchant lo activa
    // en el dashboard; no-op si está deshabilitado.
    automatic_tax: { enabled: false },
    allow_promotion_codes: true,
  })

  if (!session.url) {
    throw new Error('[STRIPE_CHECKOUT_FAILED] Stripe no devolvió URL de checkout')
  }
  return { url: session.url, sessionId: session.id }
}

/**
 * Crea una Billing Portal Session (Stripe-hosted) para que el usuario
 * gestione su suscripción (cambiar plan, actualizar tarjeta, cancelar).
 * Requiere que el customer ya exista en Stripe.
 */
export async function createBillingPortalSession(input: {
  customerId: string
  returnUrl: string
}): Promise<{ url: string }> {
  const stripe = requireStripeClient()
  const session = await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl,
  })
  return { url: session.url }
}

/**
 * Recupera el estado actual de una suscripción Stripe. Útil para
 * conciliación manual o reconstrucción del estado tras pérdida de webhook.
 */
export async function getSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = requireStripeClient()
  return stripe.subscriptions.retrieve(subscriptionId)
}

/**
 * Cancela una suscripción Stripe. Default: cancelación al final del periodo
 * (el usuario conserva acceso hasta `currentPeriodEnd`). Pasar
 * `immediate: true` para baja inmediata + prorrateo.
 */
export async function cancelSubscription(input: {
  subscriptionId: string
  immediate?: boolean
}): Promise<Stripe.Subscription> {
  const stripe = requireStripeClient()
  if (input.immediate) {
    return stripe.subscriptions.cancel(input.subscriptionId)
  }
  return stripe.subscriptions.update(input.subscriptionId, {
    cancel_at_period_end: true,
  })
}

/**
 * Valida la firma del webhook recibido. Throws si no coincide o si el secret
 * no está configurado. Devuelve el `Stripe.Event` ya parseado.
 *
 * IMPORTANTE: `rawBody` debe ser el body crudo (string) — Next.js route
 * handlers reciben el body vía `await req.text()`. Si usas `req.json()`
 * Stripe rechazará la firma (los espacios cambian).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): Stripe.Event {
  const stripe = requireStripeClient()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new Error(
      '[STRIPE_WEBHOOK_SECRET_MISSING] STRIPE_WEBHOOK_SECRET requerida',
    )
  }
  return stripe.webhooks.constructEvent(rawBody, signature, secret)
}
