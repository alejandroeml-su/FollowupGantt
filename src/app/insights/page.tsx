/**
 * Ola P5 · Equipo P5-4 · AI Insights — Página `/insights`.
 *
 * Server component. Carga:
 *   - Resumen por proyecto (counts por kind).
 *   - Top 10 tareas con riesgo alto (vista global).
 *   - Lista de Next Actions globales activas.
 *
 * Sin auth real: leemos todos los proyectos no archivados (igual que el
 * resto del repo en P1/P2). Cuando se promueva la sesión real, filtrar
 * por `assignments`.
 */

import prisma from '@/lib/prisma'
import {
  getProjectInsightSummariesBulk,
  getProjectRiskOverview,
} from '@/lib/actions/insights'
import {
  InsightsDashboard,
  type ProjectSummaryEntry,
} from '@/components/ai/InsightsDashboard'
import type { NextActionItem } from '@/components/ai/NextActionsList'

export const metadata = {
  title: 'Insights · Sync',
  description: 'AI insights heurísticos: categorización, riesgo y sugerencias.',
}

export default async function InsightsPage(): Promise<React.JSX.Element> {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  // P17-A · N+1 fix: antes hacíamos un await por proyecto en loop.
  // Ahora obtenemos todos los resúmenes en 2 queries.
  const summaryRows = await getProjectInsightSummariesBulk(projects.map((p) => p.id))
  const summaryById = new Map(summaryRows.map((s) => [s.projectId, s]))
  const summaries: ProjectSummaryEntry[] = projects.map((p) => {
    const s = summaryById.get(p.id) ?? {
      categorization: 0,
      delayRisk: 0,
      nextAction: 0,
      highRisk: 0,
    }
    return {
      id: p.id,
      name: p.name,
      categorization: s.categorization,
      delayRisk: s.delayRisk,
      nextAction: s.nextAction,
      highRisk: s.highRisk,
    }
  })

  const topRisks = await getProjectRiskOverview(10)

  const nextActionRows = await prisma.taskInsight.findMany({
    where: { kind: 'NEXT_ACTION', dismissedAt: null },
    orderBy: { score: 'desc' },
    take: 20,
    select: { id: true, score: true, payload: true },
  })
  const nextActions: NextActionItem[] = nextActionRows.map((row) => {
    const payload = (row.payload ?? {}) as {
      key?: string
      message?: string
      projectId?: string
      projectName?: string
    }
    return {
      insightId: row.id,
      projectId: payload.projectId ?? '',
      projectName: payload.projectName ?? 'Sin proyecto',
      message: payload.message ?? 'Sugerencia',
      severity: row.score,
    }
  })

  return (
    <InsightsDashboard
      projects={summaries}
      topRisks={topRisks}
      nextActions={nextActions}
    />
  )
}
