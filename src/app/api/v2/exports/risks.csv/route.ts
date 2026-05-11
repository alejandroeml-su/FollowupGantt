/**
 * Wave R3.0 Fase 4.2 · BI Export Connector.
 *
 * `GET /api/v2/exports/risks.csv` — exporta riesgos del workspace con
 * `score` y `severity` calculados (matriz 5×5 PMBOK).
 *
 * Columnas:
 *   id, projectId, project, title, probability, impact, score, severity,
 *   status, owner, mitigation, taskId, source, detectedAt, closedAt,
 *   createdAt, updatedAt.
 *
 * Query params:
 *   - `projectId`  filtra por proyecto.
 *   - `severity`   LOW | MEDIUM | HIGH | CRITICAL (post-filtro en memoria).
 *   - `cursor`     paginación.
 *   - `limit`      1..5000.
 *
 * Scope: `read:exports`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponseFromException } from '@/lib/api/v2-response'
import { requireApiKey } from '@/app/api/v2/_helpers'
import { csvResponse, parseCsvPagination, type CsvColumn } from '@/lib/api/csv-writer'
import { tierFromScore } from '@/lib/risks/risk-score'

export const dynamic = 'force-dynamic'

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
type Severity = (typeof SEVERITIES)[number]
const SEVERITY_SET = new Set<string>(SEVERITIES)

type RiskRow = {
  id: string
  projectId: string
  project: string
  title: string
  probability: number
  impact: number
  score: number
  severity: Severity
  status: string
  owner: string
  mitigation: string | null
  taskId: string | null
  source: string
  detectedAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const COLUMNS: ReadonlyArray<CsvColumn<RiskRow>> = [
  { header: 'id', value: (r) => r.id },
  { header: 'projectId', value: (r) => r.projectId },
  { header: 'project', value: (r) => r.project },
  { header: 'title', value: (r) => r.title },
  { header: 'probability', value: (r) => r.probability },
  { header: 'impact', value: (r) => r.impact },
  { header: 'score', value: (r) => r.score },
  { header: 'severity', value: (r) => r.severity },
  { header: 'status', value: (r) => r.status },
  { header: 'owner', value: (r) => r.owner },
  { header: 'mitigation', value: (r) => r.mitigation },
  { header: 'taskId', value: (r) => r.taskId },
  { header: 'source', value: (r) => r.source },
  { header: 'detectedAt', value: (r) => r.detectedAt },
  { header: 'closedAt', value: (r) => r.closedAt },
  { header: 'createdAt', value: (r) => r.createdAt },
  { header: 'updatedAt', value: (r) => r.updatedAt },
]

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:exports')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parseCsvPagination(url)

    const projectId = url.searchParams.get('projectId')
    const severityRaw = url.searchParams.get('severity')
    const severityFilter: Severity | null =
      severityRaw && SEVERITY_SET.has(severityRaw) ? (severityRaw as Severity) : null

    const where: Record<string, unknown> = {
      project: { workspaceId },
    }
    if (projectId) where.projectId = projectId

    // Si hay filtro de severity (no es columna en DB) pedimos un buffer
    // mayor — mismo patrón que `/api/v2/risks`.
    const fetchLimit = severityFilter ? Math.min(25000, (limit + 1) * 5) : limit + 1

    const rows = await prisma.risk.findMany({
      where,
      orderBy: { id: 'asc' },
      take: fetchLimit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        projectId: true,
        title: true,
        probability: true,
        impact: true,
        status: true,
        mitigation: true,
        taskId: true,
        source: true,
        detectedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
        project: { select: { name: true } },
        owner: { select: { name: true, email: true } },
      },
    })

    const enriched: RiskRow[] = rows.map((r) => {
      const score = r.probability * r.impact
      return {
        id: r.id,
        projectId: r.projectId,
        project: r.project?.name ?? '',
        title: r.title,
        probability: r.probability,
        impact: r.impact,
        score,
        severity: tierFromScore(score),
        status: r.status,
        owner: r.owner
          ? `${r.owner.name}${r.owner.email ? ` <${r.owner.email}>` : ''}`
          : '',
        mitigation: r.mitigation,
        taskId: r.taskId,
        source: r.source,
        detectedAt: r.detectedAt,
        closedAt: r.closedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }
    })

    const filtered = severityFilter
      ? enriched.filter((r) => r.severity === severityFilter)
      : enriched

    let pageRows = filtered
    let nextCursor: string | null = null
    if (filtered.length > limit) {
      pageRows = filtered.slice(0, limit)
      nextCursor = pageRows[pageRows.length - 1]?.id ?? null
    }

    return csvResponse({
      entity: 'risks',
      columns: COLUMNS,
      rows: pageRows,
      nextCursorHeader: nextCursor,
    })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
