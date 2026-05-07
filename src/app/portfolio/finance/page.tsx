import Link from 'next/link'
import { ArrowLeft, DollarSign } from 'lucide-react'
import { loadPortfolioFinance } from '@/lib/portfolio/finance'
import { EvmDashboard } from '@/components/portfolio/EvmDashboard'

export const dynamic = 'force-dynamic'

type SearchParams = {
  area?: string
  manager?: string
}

type PageProps = {
  searchParams: Promise<SearchParams>
}

export default async function PortfolioFinancePage({ searchParams }: PageProps) {
  const params = await searchParams

  const overview = await loadPortfolioFinance({
    areaId: params.area ?? null,
    managerId: params.manager ?? null,
    excludeClosed: true,
  })

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
            <DollarSign className="h-5 w-5 text-emerald-400" />
            Costos &amp; EVM consolidado
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reporting financiero CFO/PMO · {overview.projects.length} proyecto
            {overview.projects.length === 1 ? '' : 's'} · generado{' '}
            {new Date(overview.generatedAt).toLocaleString('es-MX')}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl">
          <EvmDashboard overview={overview} />
        </div>
      </div>
    </div>
  )
}
