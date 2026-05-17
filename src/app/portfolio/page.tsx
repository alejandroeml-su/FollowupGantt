import { Layers } from 'lucide-react'
import { loadPortfolioOverview } from '@/lib/portfolio/aggregations'
import { PortfolioDashboard } from '@/components/portfolio/PortfolioDashboard'
import { getServerT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

type SearchParams = {
  area?: string
  manager?: string
  health?: 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'BLOCKED'
}

type PageProps = {
  searchParams: Promise<SearchParams>
}

export default async function PortfolioPage({ searchParams }: PageProps) {
  const params = await searchParams

  const overview = await loadPortfolioOverview({
    areaId: params.area ?? null,
    managerId: params.manager ?? null,
    health: params.health ?? null,
    excludeClosed: true,
  })

  // Wave R5E (2026-05-17) — Header bilingüe.
  const t = await getServerT()

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <Layers className="h-5 w-5 text-indigo-400" />
            {t('pages.portfolio.title')}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('pages.portfolio.subtitle')} · {overview.totals.projects} ·{' '}
            {new Date(overview.generatedAt).toLocaleString('es-MX')}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <PortfolioDashboard overview={overview} />
      </div>
    </div>
  )
}
