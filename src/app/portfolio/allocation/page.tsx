import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import { getAllocationForRangePaginated } from '@/lib/actions/allocation'
import { AllocationHeatmap } from '@/components/allocation/AllocationHeatmap'

export const dynamic = 'force-dynamic'

// P17-A · paginamos el heatmap por usuario para evitar cargar matrices
// gigantes en organizaciones grandes. Tope inicial 50 usuarios; el
// componente puede pedir más vía botón "Cargar más" (próxima R2).
const ALLOC_USERS_PER_PAGE = 50

export default async function PortfolioAllocationPage() {
  const page = await getAllocationForRangePaginated({
    daysAhead: 28,
    limit: ALLOC_USERS_PER_PAGE,
  })
  const snapshots = page.snapshots

  const overAllocatedCount = snapshots.filter((s) => s.overAllocated).length

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Portfolio
          </Link>
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <Users className="h-5 w-5 text-violet-400" />
            Allocation cross-project
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Carga semanal del equipo distribuida por proyecto · próximas 4
            semanas
            {overAllocatedCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                ⚠ {overAllocatedCount} celda
                {overAllocatedCount === 1 ? '' : 's'} over-allocated
              </span>
            )}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-3">
          {page.nextCursor && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Mostrando los primeros {ALLOC_USERS_PER_PAGE} usuarios. Hay más
              datos disponibles — la paginación cliente con cursor llegará en
              R2.
            </p>
          )}
          <AllocationHeatmap snapshots={snapshots} />
        </div>
      </div>
    </div>
  )
}
