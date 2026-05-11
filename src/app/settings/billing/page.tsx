/**
 * Wave R4-E · /settings/billing
 *
 * Página de gestión de suscripción Stripe + historial de facturas.
 * Requiere sesión + rol ADMIN/OWNER del workspace activo (o admin global).
 */

import { redirect } from 'next/navigation'
import { CreditCard } from 'lucide-react'

import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { requireWorkspaceAccess } from '@/lib/auth/check-workspace-access'
import { getActiveWorkspaceId } from '@/lib/actions/workspaces'
import { getWorkspaceSubscription } from '@/lib/billing/subscription'
import { type PricingTier, PRICING_TIERS } from '@/lib/billing/pricing'
import { hasAdminRole } from '@/lib/auth/permissions'
import PricingTable from '@/components/billing/PricingTable'
import CurrentPlan, {
  type CurrentPlanInvoice,
  type CurrentPlanSubscription,
} from '@/components/billing/CurrentPlan'

export const dynamic = 'force-dynamic'

export default async function BillingSettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/settings/billing')

  const activeId = await getActiveWorkspaceId()
  if (!activeId) {
    redirect('/settings/workspace')
  }

  // requireWorkspaceAccess garantiza que el usuario es miembro o admin global.
  const { role } = await requireWorkspaceAccess(activeId)
  const isManager =
    hasAdminRole(user.roles) || role === 'OWNER' || role === 'ADMIN'

  const sub = await getWorkspaceSubscription(activeId)
  const invoicesDb = await prisma.billingInvoice.findMany({
    where: { workspaceId: activeId },
    orderBy: { createdAt: 'desc' },
    take: 12,
  })

  const subscription: CurrentPlanSubscription = {
    tier: sub.tier,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    cancelAt: sub.cancelAt?.toISOString() ?? null,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    seats: sub.seats,
    stripeCustomerId: sub.stripeCustomerId,
  }

  const invoices: CurrentPlanInvoice[] = invoicesDb.map((inv) => ({
    id: inv.id,
    stripeInvoiceId: inv.stripeInvoiceId,
    amountCents: inv.amountCents,
    currency: inv.currency,
    status: inv.status,
    invoicePdfUrl: inv.invoicePdfUrl,
    periodStart: inv.periodStart.toISOString(),
    periodEnd: inv.periodEnd.toISOString(),
    createdAt: inv.createdAt.toISOString(),
  }))

  const currentTier: PricingTier = sub.tier in PRICING_TIERS ? sub.tier : 'FREE'

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <CreditCard className="h-6 w-6 text-primary" />
            Suscripción y facturación
          </h1>
          <p className="text-sm text-muted-foreground">
            Plan vigente, historial de facturas y cambio de plan vía Stripe.
          </p>
        </header>

        <CurrentPlan
          workspaceId={activeId}
          subscription={subscription}
          invoices={invoices}
          isManager={isManager}
        />

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Cambia de plan
          </h2>
          <PricingTable
            workspaceId={activeId}
            currentTier={currentTier}
            isManager={isManager}
          />
        </section>
      </div>
    </div>
  )
}
