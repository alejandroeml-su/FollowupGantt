'use client'

/**
 * Wave R4-E · Tabla de precios SaaS.
 *
 * Renderiza las 3 tarjetas (Free/Pro/Enterprise) con features + límites.
 * El botón "Upgrade" llama a `/api/billing/checkout` y redirige al user
 * a Stripe Checkout (hosted).
 *
 * Props:
 *   - workspaceId  : workspace al que aplicar el upgrade.
 *   - currentTier  : tier vigente — el botón cambia a "Plan actual" / disabled.
 *   - isManager    : si false, los botones de upgrade quedan en read-only
 *                    (visual hint — la API también valida).
 */

import { useState, useTransition } from 'react'

import { PRICING_TIERS, type PricingTier, TIER_ORDER } from '@/lib/billing/pricing'

type PricingTableProps = {
  workspaceId: string
  currentTier: PricingTier
  isManager: boolean
}

export default function PricingTable({
  workspaceId,
  currentTier,
  isManager,
}: PricingTableProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [loadingTier, setLoadingTier] = useState<PricingTier | null>(null)

  async function handleUpgrade(tier: PricingTier) {
    if (tier === 'FREE') return
    setError(null)
    setLoadingTier(tier)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, tier }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'No se pudo iniciar checkout')
      }
      if (typeof data.url === 'string') {
        window.location.assign(data.url)
        return
      }
      throw new Error('Stripe no devolvió URL de checkout')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    } finally {
      setLoadingTier(null)
    }
  }

  return (
    <div>
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {TIER_ORDER.map((tier) => {
          const t = PRICING_TIERS[tier]
          const isCurrent = tier === currentTier
          const isDisabled = !isManager || tier === 'FREE' || pending || loadingTier !== null
          return (
            <div
              key={tier}
              className={`flex flex-col rounded-lg border p-4 shadow-sm ${
                isCurrent
                  ? 'border-blue-500 ring-2 ring-blue-500/40'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-lg font-semibold">{t.label}</h3>
                {isCurrent ? (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                    Plan actual
                  </span>
                ) : null}
              </div>
              <div className="mb-2">
                <span className="text-3xl font-bold">${t.priceMonthly}</span>
                <span className="text-sm text-gray-500"> / usuario / mes</span>
              </div>
              <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">{t.description}</p>
              <ul className="mb-4 space-y-1 text-sm">
                <li>
                  <strong>Usuarios:</strong> {t.users === -1 ? 'Ilimitados' : t.users}
                </li>
                <li>
                  <strong>Proyectos:</strong> {t.projects === -1 ? 'Ilimitados' : t.projects}
                </li>
                <li>
                  <strong>Storage:</strong> {t.storageGB} GB
                </li>
                <li>
                  <strong>Brain calls/mes:</strong> {t.brainCalls.toLocaleString()}
                </li>
                <li>
                  <strong>Features:</strong>{' '}
                  {t.features.filter((f) => f !== '*').join(', ') || '—'}
                </li>
              </ul>
              <button
                type="button"
                onClick={() => startTransition(() => handleUpgrade(tier))}
                disabled={isDisabled || isCurrent}
                aria-busy={loadingTier === tier}
                className={`mt-auto rounded px-3 py-2 text-sm font-medium transition ${
                  isCurrent
                    ? 'cursor-default bg-gray-100 text-gray-500 dark:bg-gray-800'
                    : isDisabled
                      ? 'cursor-not-allowed bg-gray-200 text-gray-500 dark:bg-gray-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isCurrent
                  ? 'Plan actual'
                  : tier === 'FREE'
                    ? 'Plan inicial'
                    : loadingTier === tier
                      ? 'Redirigiendo…'
                      : t.cta}
              </button>
            </div>
          )
        })}
      </div>
      {!isManager ? (
        <p className="mt-3 text-xs text-gray-500">
          Solo OWNER/ADMIN del workspace pueden cambiar el plan.
        </p>
      ) : null}
    </div>
  )
}
