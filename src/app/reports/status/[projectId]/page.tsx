import { getStatusReport } from '@/lib/actions/reports'
import { StatusReportView } from '@/components/reports/StatusReportView'
import '../../../print.css'

/**
 * Ola P5 · Equipo P5-3 · Status Report semanal imprimible.
 *
 * Esta página es server component. Carga el snapshot vía
 * `getStatusReport`, que aplica `requireProjectAccess` (lanza FORBIDDEN
 * si el usuario no pertenece al proyecto y no es admin).
 */
export const dynamic = 'force-dynamic'

export default async function StatusReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const data = await getStatusReport(projectId)
  return <StatusReportView data={data} />
}
