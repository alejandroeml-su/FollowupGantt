'use client'

/**
 * Wave R4-E · Card del plan vigente + historial de facturas.
 *
 * Props:
 *   - subscription : estado serializado desde el server (no contiene
 *                    objetos Stripe — solo strings/numbers/Date ISO).
 *   - invoices     : últimas N facturas (ya ordenadas desc por createdAt).
 *   - isManager    : controla visibilidad del botón "Manage subscription".
 */

import { useState, useTransition } from 'react'

import { PRICING_TIERS, type PricingTier } from '@/lib/billing/pricing'

export type CurrentPlanSubscription = {
  tier: PricingTier
  status: string
  currentPeriodEnd: string | null
  cancelAt: string | null
  trialEndsAt: string | null
  seats: number
  stripeCustomerId: string | null
}

export type CurrentPlanInvoice = {
  id: string
  stripeInvoiceId: string
  amountCents: number
  currency: string
  status: string
  invoicePdfUrl: string | null
  periodStart: string
  periodEnd: string
  createdAt: string
}

type Props = {
  workspaceId: string
  subscription: CurrentPlanSubscription
  invoices: CurrentPlanInvoice[]
  isManager: boolean
}

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

export default function CurrentPlan({ workspaceId, subscription, invoices, isManager }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const tierLimits = PRICING_TIERS[subscription.tier]

  async function openPortal() {
    setError(null)
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'No se pudo abrir el portal')
      }
      if (typeof data.url === 'string') {
        window.location.assign(data.url)
        return
      }
      throw new Error('Stripe no devolvió URL del portal')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
    }
  }

  const statusBadgeClass = ((): string => {
    switch (subscription.status) {
      case 'active':
      case 'trialing':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
      case 'past_due':
      case 'unpaid':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
      case 'canceled':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
    }
  })()

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{tierLimits.label}</h2>
            <p className="text-sm text-gray-500">
              ${tierLimits.priceMonthly} USD / usuario / mes · {subscription.seats}{' '}
              {subscription.seats === 1 ? 'asiento' : 'asientos'}
            </p>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass}`}
            data-testid="subscription-status"
          >
            {subscription.status}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {subscription.currentPeriodEnd ? (
            <>
              <dt className="text-gray-500">Próxima renovación</dt>
              <dd>{formatDate(subscription.currentPeriodEnd)}</dd>
            </>
          ) : null}
          {subscription.trialEndsAt ? (
            <>
              <dt className="text-gray-500">Fin del trial</dt>
              <dd>{formatDate(subscription.trialEndsAt)}</dd>
            </>
          ) : null}
          {subscription.cancelAt ? (
            <>
              <dt className="text-gray-500">Cancelación programada</dt>
              <dd>{formatDate(subscription.cancelAt)}</dd>
            </>
          ) : null}
        </dl>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
        {isManager && subscription.stripeCustomerId ? (
          <button
            type="button"
            onClick={() => startTransition(openPortal)}
            disabled={pending}
            className="mt-4 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pending ? 'Abriendo…' : 'Gestionar suscripción'}
          </button>
        ) : null}
      </section>

      <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h3 className="mb-3 text-lg font-semibold">Historial de facturas</h3>
        {invoices.length === 0 ? (
          <p className="text-sm text-gray-500">No hay facturas registradas todavía.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-2">Fecha</th>
                <th>Periodo</th>
                <th>Monto</th>
                <th>Estado</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-2">{formatDate(inv.createdAt)}</td>
                  <td>
                    {formatDate(inv.periodStart)} — {formatDate(inv.periodEnd)}
                  </td>
                  <td>{formatCurrency(inv.amountCents, inv.currency)}</td>
                  <td>{inv.status}</td>
                  <td>
                    {inv.invoicePdfUrl ? (
                      <a
                        href={inv.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Descargar
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
