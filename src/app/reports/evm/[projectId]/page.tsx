import { getEVMReport } from '@/lib/actions/reports'
import { EVMReportView } from '@/components/reports/EVMReportView'
import '../../../print.css'

/**
 * Ola P5 · Equipo P5-3 · Reporte EVM imprimible.
 *
 * Si el cálculo lanza `[INSUFFICIENT_DATA]` (sin presupuesto en ninguna
 * tarea) Next.js usa el `error.tsx` global o muestra un 500. En una
 * iteración futura podemos agregar un `error.tsx` local con mensaje ES.
 */
export const dynamic = 'force-dynamic'

export default async function EVMReportPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const data = await getEVMReport(projectId)
  return <EVMReportView data={data} />
}
