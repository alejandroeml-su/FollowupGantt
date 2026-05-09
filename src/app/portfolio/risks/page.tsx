import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { loadConsolidatedRisks } from '@/lib/portfolio/risks'
import { PortfolioRisksClient } from '@/components/portfolio/PortfolioRisksClient'

export const dynamic = 'force-dynamic'

type SearchParams = {
  project?: string
  owner?: string
}

type PageProps = {
  searchParams: Promise<SearchParams>
}

export default async function PortfolioRisksPage({ searchParams }: PageProps) {
  const params = await searchParams

  const overview = await loadConsolidatedRisks({
    projectId: params.project ?? null,
    ownerId: params.owner ?? null,
    excludeClosed: true,
  })

  const totalRisks = overview.totals.high + overview.totals.medium + overview.totals.low

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4 print:px-3 print:py-2">
        <div>
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground print:hidden"
          >
            <ArrowLeft className="h-3 w-3" /> Portfolio
          </Link>
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <ShieldAlert className="h-5 w-5 text-rose-400" />
            Riesgos consolidados
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {totalRisks} riesgo{totalRisks === 1 ? '' : 's'} activo
            {totalRisks === 1 ? '' : 's'} en el portafolio · generado{' '}
            {new Date(overview.generatedAt).toLocaleString('es-MX')}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 print:p-2">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* KPIs por severity */}
          <section className="grid grid-cols-3 gap-3 md:grid-cols-6">
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/15 p-3">
              <p className="text-[10px] uppercase tracking-wider text-rose-300">
                Alto
              </p>
              <p className="mt-1 text-2xl font-bold text-rose-200">
                {overview.totals.high}
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/15 p-3">
              <p className="text-[10px] uppercase tracking-wider text-amber-300">
                Medio
              </p>
              <p className="mt-1 text-2xl font-bold text-amber-200">
                {overview.totals.medium}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 p-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300">
                Bajo
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-200">
                {overview.totals.low}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Open
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {overview.totals.open}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Mitigando
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {overview.totals.mitigating}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Aceptado
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {overview.totals.accepted}
              </p>
            </div>
          </section>

          {/* Wave P14c — wrapper client con filtro por celda matriz */}
          <PortfolioRisksClient
            items={overview.items}
            matrix={overview.matrix}
          />
        </div>
      </div>
    </div>
  )
}
