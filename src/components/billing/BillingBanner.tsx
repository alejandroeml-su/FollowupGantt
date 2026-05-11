'use client'

/**
 * Wave R4-E · Banner global de billing.
 *
 * Muestra alertas no-bloqueantes cuando:
 *   - subscription.status === 'past_due' o 'unpaid' (rojo).
 *   - trialEndsAt < ahora + 7 días (ambar).
 *
 * Recibe `currentTimeMs` para mantener el render puro (Next.js 16 con
 * React Compiler rechaza `Date.now()` durante render). El caller (RSC)
 * inyecta `Date.now()` al pasar la prop.
 */

import type { CurrentPlanSubscription } from './CurrentPlan'

type Props = {
  subscription: CurrentPlanSubscription | null
  /** Timestamp en ms del momento del render (inyectado por el RSC parent). */
  currentTimeMs: number
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export default function BillingBanner({ subscription, currentTimeMs }: Props) {
  if (!subscription) return null

  if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
    return (
      <div
        role="alert"
        className="border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300"
      >
        Tu pago está pendiente. Actualiza tu método de pago en{' '}
        <a href="/settings/billing" className="font-medium underline">
          Configuración → Billing
        </a>
        .
      </div>
    )
  }

  if (subscription.trialEndsAt) {
    const ends = new Date(subscription.trialEndsAt).getTime()
    if (ends > currentTimeMs && ends - currentTimeMs < SEVEN_DAYS_MS) {
      const daysLeft = Math.max(
        1,
        Math.ceil((ends - currentTimeMs) / (24 * 60 * 60 * 1000)),
      )
      return (
        <div
          role="status"
          className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200"
        >
          Tu trial termina en {daysLeft} {daysLeft === 1 ? 'día' : 'días'}.{' '}
          <a href="/settings/billing" className="font-medium underline">
            Confirma tu plan
          </a>{' '}
          para evitar interrupciones.
        </div>
      )
    }
  }

  return null
}
