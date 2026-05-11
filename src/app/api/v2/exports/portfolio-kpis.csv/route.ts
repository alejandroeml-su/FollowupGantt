/**
 * Wave R3.0 Fase 4.2 · BI Export Connector.
 *
 * `GET /api/v2/exports/portfolio-kpis.csv` — snapshot agregado del
 * estado del portafolio, una fila por proyecto.
 *
 * Columnas:
 *   projectId, project, status, methodology, cpi, spi,
 *   totalTasks, doneTasks, completionPct, openRisks, criticalRisks,
 *   criticalDefects, openDefects, totalBudget, budgetCurrency.
 *
 * `completionPct` se calcula como `100 * doneTasks / totalTasks` con 1
 * decimal (0 cuando no hay tasks). `openRisks` cuenta status ∈
 * {OPEN, MITIGATING}; `criticalRisks` cuenta los OPEN/MITIGATING con
 * tier CRITICAL (score >= 15 en matriz 5×5 PMBOK).
 *
 * No soporta `cursor` (es agregado · normalmente 1 fila por proyecto, y
 * los workspaces tienen <500 proyectos en la práctica). Si se requiere
 * pagedo a futuro, agregar `cursor` + `limit` siguiendo el patrón de
 * los otros endpoints.
 *
 * Scope: `read:exports`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponseFromException } from '@/lib/api/v2-response'
import { requireApiKey } from '@/app/api/v2/_helpers'
import { csvResponse, type CsvColumn } from '@/lib/api/csv-writer'
import { tierFromScore } from '@/lib/risks/risk-score'

export const dynamic = 'force-dynamic'

type KpiRow = {
  projectId: string
  project: string
  status: string
  methodology: string
  cpi: number | null
  spi: number | null
  totalTasks: number
  doneTasks: number
  completionPct: number
  openRisks: number
  criticalRisks: number
  openDefects: number
  criticalDefects: number
  totalBudget: string | null
  budgetCurrency: string | null
}

const COLUMNS: ReadonlyArray<CsvColumn<KpiRow>> = [
  { header: 'projectId', value: (r) => r.projectId },
  { header: 'project', value: (r) => r.project },
  { header: 'status', value: (r) => r.status },
  { header: 'methodology', value: (r) => r.methodology },
  { header: 'cpi', value: (r) => r.cpi },
  { header: 'spi', value: (r) => r.spi },
  { header: 'totalTasks', value: (r) => r.totalTasks },
  { header: 'doneTasks', value: (r) => r.doneTasks },
  { header: 'completionPct', value: (r) => r.completionPct },
  { header: 'openRisks', value: (r) => r.openRisks },
  { header: 'criticalRisks', value: (r) => r.criticalRisks },
  { header: 'openDefects', value: (r) => r.openDefects },
  { header: 'criticalDefects', value: (r) => r.criticalDefects },
  { header: 'totalBudget', value: (r) => r.totalBudget },
  { header: 'budgetCurrency', value: (r) => r.budgetCurrency },
]

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:exports')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const projects = await prisma.project.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        methodology: true,
        cpi: true,
        spi: true,
        budget: true,
        budgetCurrency: true,
      },
    })

    if (projects.length === 0) {
      return csvResponse({ entity: 'portfolio-kpis', columns: COLUMNS, rows: [] })
    }

    const projectIds = projects.map((p) => p.id)

    // Aggregations paralelos para minimizar latencia.
    const [tasksByProject, doneByProject, risks, defects] = await Promise.all([
      prisma.task.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, status: 'DONE' },
        _count: { _all: true },
      }),
      prisma.risk.findMany({
        where: {
          projectId: { in: projectIds },
          status: { in: ['OPEN', 'MITIGATING'] },
        },
        select: { projectId: true, probability: true, impact: true },
      }),
      prisma.defect.findMany({
        where: {
          projectId: { in: projectIds },
          status: { in: ['OPEN', 'IN_REVIEW'] },
        },
        select: { projectId: true, severity: true },
      }),
    ])

    const tasksMap = new Map<string, number>()
    for (const t of tasksByProject) tasksMap.set(t.projectId, t._count._all)

    const doneMap = new Map<string, number>()
    for (const t of doneByProject) doneMap.set(t.projectId, t._count._all)

    const riskMap = new Map<string, { open: number; critical: number }>()
    for (const r of risks) {
      const slot = riskMap.get(r.projectId) ?? { open: 0, critical: 0 }
      slot.open += 1
      if (tierFromScore(r.probability * r.impact) === 'CRITICAL') slot.critical += 1
      riskMap.set(r.projectId, slot)
    }

    const defectMap = new Map<string, { open: number; critical: number }>()
    for (const d of defects) {
      const slot = defectMap.get(d.projectId) ?? { open: 0, critical: 0 }
      slot.open += 1
      if (d.severity === 'CRITICAL') slot.critical += 1
      defectMap.set(d.projectId, slot)
    }

    const rows: KpiRow[] = projects.map((p) => {
      const total = tasksMap.get(p.id) ?? 0
      const done = doneMap.get(p.id) ?? 0
      const pct = total > 0 ? Math.round((done / total) * 1000) / 10 : 0
      const risk = riskMap.get(p.id) ?? { open: 0, critical: 0 }
      const defect = defectMap.get(p.id) ?? { open: 0, critical: 0 }
      return {
        projectId: p.id,
        project: p.name,
        status: p.status,
        methodology: p.methodology,
        cpi: p.cpi,
        spi: p.spi,
        totalTasks: total,
        doneTasks: done,
        completionPct: pct,
        openRisks: risk.open,
        criticalRisks: risk.critical,
        openDefects: defect.open,
        criticalDefects: defect.critical,
        totalBudget: p.budget ? p.budget.toString() : null,
        budgetCurrency: p.budgetCurrency,
      }
    })

    return csvResponse({ entity: 'portfolio-kpis', columns: COLUMNS, rows })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
