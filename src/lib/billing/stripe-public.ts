/**
 * Wave R4-E · Stripe.js loader (client-only).
 *
 * Wrapper minimalista alrededor de `@stripe/stripe-js`. El loader lee la
 * publishable key del bundle público (NEXT_PUBLIC_*) y la cachea para
 * evitar múltiples cargas del script.
 *
 * El flujo MVP no requiere Stripe.js en el cliente — la página de checkout
 * vive en stripe.com (hosted Checkout). Mantenemos este módulo por si una
 * futura iteración integra el Payment Element embebido.
 */

import { loadStripe, type Stripe } from '@stripe/stripe-js'

let stripePromise: Promise<Stripe | null> | null = null

/**
 * Devuelve la promesa singleton del Stripe.js client. Si la publishable key
 * no está configurada, devuelve `Promise<null>` — los callers deben fallback
 * a redirección Stripe-hosted.
 */
export function getStripePublic(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  if (!key) {
    stripePromise = Promise.resolve(null)
    return stripePromise
  }
  stripePromise = loadStripe(key)
  return stripePromise
}
