import { getPortfolioReport } from '@/lib/actions/reports'
import { generateExecutiveBriefingAction } from '@/lib/actions/summaries'
import { PortfolioView } from '@/components/reports/PortfolioView'
import { AINarrativeSection } from '@/components/reports/AINarrativeSection'
import '../../print.css'

/**
 * Ola P5 · Equipo P5-3 · Dashboard portafolio imprimible.
 * Ola P7 · Equipo P7-3 · Executive briefing IA al inicio.
 *
 * Sólo accesible para SUPER_ADMIN/ADMIN/PM (validación en
 * `getPortfolioReport` y `generateExecutiveBriefingAction`).
 */
export const dynamic = 'force-dynamic'

export default async function PortfolioReportPage() {
  const data = await getPortfolioReport()
  const briefing = await generateExecutiveBriefingAction({})

  async function regenerateBriefing() {
    'use server'
    return generateExecutiveBriefingAction({ bypassCache: true })
  }

  return (
    <>
      <AINarrativeSection
        narrative={briefing}
        regenerate={regenerateBriefing}
        title="Executive briefing IA"
      />
      <PortfolioView data={data} />
    </>
  )
}
