import { getPortfolioReport } from '@/lib/actions/reports'
import { PortfolioView } from '@/components/reports/PortfolioView'
import '../../print.css'

/**
 * Ola P5 · Equipo P5-3 · Portfolio dashboard imprimible.
 *
 * Sólo accesible para SUPER_ADMIN/ADMIN/PM (validación en
 * `getPortfolioReport`).
 */
export const dynamic = 'force-dynamic'

export default async function PortfolioReportPage() {
  const data = await getPortfolioReport()
  return <PortfolioView data={data} />
}
