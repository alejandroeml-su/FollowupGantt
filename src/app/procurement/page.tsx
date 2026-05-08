import { Briefcase } from 'lucide-react'
import prisma from '@/lib/prisma'
import {
  listVendors,
  listContracts,
  listPurchaseOrders,
} from '@/lib/actions/procurement'
import { ProcurementClient } from '@/components/procurement/ProcurementClient'

export const dynamic = 'force-dynamic'

export default async function ProcurementPage() {
  const [vendors, contracts, purchaseOrders, projects] = await Promise.all([
    listVendors(),
    listContracts(),
    listPurchaseOrders(),
    prisma.project.findMany({
      where: { status: { notIn: ['COMPLETED'] } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <Briefcase className="h-5 w-5 text-emerald-400" />
            Procurement
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PMBOK Procurement Management · Vendors · Contracts · Purchase Orders
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <ProcurementClient
          vendors={vendors}
          contracts={contracts.map((c) => ({
            ...c,
            totalValue: c.totalValue,
          }))}
          purchaseOrders={purchaseOrders.map((p) => ({ ...p, amount: p.amount }))}
          projects={projects}
        />
      </div>
    </div>
  )
}
