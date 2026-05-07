/**
 * Wave P10 (HU-10.5 · ALPHA-2) — Loader y agregaciones de riesgos
 * consolidados a nivel portfolio.
 *
 * Reutiliza el modelo `Risk` (Ola P8 P8-2) con probability/impact en escala
 * 1-5 (matriz PMBOK 5×5). Module read-only: no muta nada, no audit.
 */

import prisma from '@/lib/prisma'

export type RiskSeverity = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ConsolidatedRiskItem {
  id: string
  title: string
  description: string | null
  probability: number // 1-5
  impact: number // 1-5
  severity: RiskSeverity
  status: 'OPEN' | 'MITIGATING' | 'ACCEPTED' | 'CLOSED'
  ownerName: string | null
  projectId: string
  projectName: string
  detectedAt: string // ISO
  mitigation: string | null
}

export interface RiskMatrixCell {
  probability: number // 1-5
  impact: number // 1-5
  count: number
  /** Severity calculada del producto P×I de esta celda. */
  severity: RiskSeverity
}

export interface ConsolidatedRiskOverview {
  generatedAt: string
  items: ConsolidatedRiskItem[]
  matrix: RiskMatrixCell[]
  totals: {
    high: number
    medium: number
    low: number
    open: number
    mitigating: number
    accepted: number
    closed: number
  }
}

export interface ConsolidatedRiskFilters {
  projectId?: string | null
  ownerId?: string | null
  /** Si true (default), oculta CLOSED. */
  excludeClosed?: boolean
}

export function severityFromScore(score: number): RiskSeverity {
  if (score >= 12) return 'HIGH'
  if (score >= 6) return 'MEDIUM'
  return 'LOW'
}

/**
 * Carga riesgos a nivel portfolio (todos los proyectos accesibles) con
 * filtros opcionales y devuelve además la matriz 5×5 agregada para el heatmap.
 */
export async function loadConsolidatedRisks(
  filters: ConsolidatedRiskFilters = {},
): Promise<ConsolidatedRiskOverview> {
  const excludeClosed = filters.excludeClosed ?? true

  const where: Record<string, unknown> = {}
  if (filters.projectId) where.projectId = filters.projectId
  if (filters.ownerId) where.ownerId = filters.ownerId
  if (excludeClosed) {
    where.status = { not: 'CLOSED' }
  }

  const rows = await prisma.risk.findMany({
    where,
    orderBy: [{ detectedAt: 'desc' }],
    select: {
      id: true,
      title: true,
      description: true,
      probability: true,
      impact: true,
      status: true,
      detectedAt: true,
      mitigation: true,
      project: { select: { id: true, name: true } },
      owner: { select: { name: true } },
    },
  })

  const items: ConsolidatedRiskItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    probability: r.probability,
    impact: r.impact,
    severity: severityFromScore(r.probability * r.impact),
    status: r.status as ConsolidatedRiskItem['status'],
    ownerName: r.owner?.name ?? null,
    projectId: r.project.id,
    projectName: r.project.name,
    detectedAt: r.detectedAt.toISOString(),
    mitigation: r.mitigation,
  }))

  // Matriz 5×5: count por celda (probability, impact). Solo riesgos NO closed.
  const matrix: RiskMatrixCell[] = []
  for (let p = 1; p <= 5; p++) {
    for (let i = 1; i <= 5; i++) {
      const count = items.filter(
        (it) => it.probability === p && it.impact === i,
      ).length
      matrix.push({
        probability: p,
        impact: i,
        count,
        severity: severityFromScore(p * i),
      })
    }
  }

  const totals = items.reduce(
    (acc, it) => {
      acc[it.severity === 'HIGH' ? 'high' : it.severity === 'MEDIUM' ? 'medium' : 'low'] += 1
      switch (it.status) {
        case 'OPEN':
          acc.open += 1
          break
        case 'MITIGATING':
          acc.mitigating += 1
          break
        case 'ACCEPTED':
          acc.accepted += 1
          break
        case 'CLOSED':
          acc.closed += 1
          break
      }
      return acc
    },
    {
      high: 0,
      medium: 0,
      low: 0,
      open: 0,
      mitigating: 0,
      accepted: 0,
      closed: 0,
    },
  )

  return {
    generatedAt: new Date().toISOString(),
    items,
    matrix,
    totals,
  }
}
