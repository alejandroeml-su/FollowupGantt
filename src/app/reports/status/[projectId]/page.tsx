import { getStatusReport } from '@/lib/actions/reports'
import { generateStatusNarrativeAction } from '@/lib/actions/summaries'
import { StatusReportView } from '@/components/reports/StatusReportView'
import { AINarrativeSection } from '@/components/reports/AINarrativeSection'
import '../../../print.css'

/**
 * Ola P5 · Equipo P5-3 · Status Report semanal imprimible.
 * Ola P7 · Equipo P7-3 · Sección de narrativa IA al inicio.
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

  // Narrativa IA semanal. `withFallback` interno garantiza que si LLM no
  // está disponible se usa la heurística — no necesitamos try/catch aquí.
  const narrative = await generateStatusNarrativeAction({
    projectId,
    period: 'week',
  })

  // Server action wrapper para el botón Regenerar (Client Component).
  async function regenerateNarrative() {
    'use server'
    return generateStatusNarrativeAction({
      projectId,
      period: 'week',
      bypassCache: true,
    })
  }

  return (
    <>
      <AINarrativeSection
        narrative={narrative}
        regenerate={regenerateNarrative}
      />
      <StatusReportView data={data} />
    </>
  )
}
