/**
 * Wave R3.0 Fase 4 · Equipo P21-B · Tableau Web Data Connector.
 *
 * `GET /api/integrations/tableau/risks` — riesgos del workspace con
 * `projectName`, `ownerName`, `score=probability*impact` y `severity` tier
 * (PMBOK 5x5) ya calculados.
 *
 * Query params:
 *   - `projectId`  filtra por proyecto.
 *   - `severity`   LOW | MEDIUM | HIGH | CRITICAL (post-filtro en memoria).
 *   - `status`     OPEN | MITIGATING | CLOSED.
 *   - `cursor`     paginación por id asc.
 *   - `limit`      1..5000.
 *
 * Auth: Bearer API key v2 con scope `read:exports`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponseFromException } from '@/lib/api/v2-response'
import { requireApiKey } from '@/app/api/v2/_helpers'
import {
  isoOrNull,
  parseTableauPagination,
  tableauJsonResponse,
} from '@/lib/integrations/tableau-schema'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { tierFromScore } from '@/lib/risks/risk-score'
import type { RiskTier } from '@/lib/risks/types'

export const dynamic = 'force-dynamic'

const SEVERITIES = new Set<string>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:exports')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parseTableauPagination(url)
    const projectId = url.searchParams.get('projectId')
    const status = url.searchParams.get('status')
    const severityRaw = url.searchParams.get('severity')
    const severityFilter: RiskTier | null =
      severityRaw && SEVERITIES.has(severityRaw) ? (severityRaw as RiskTier) : null

    const where: Record<string, unknown> = { project: { workspaceId } }
    if (projectId) where.projectId = projectId
    if (status) where.status = status

    const fetchLimit = severityFilter
      ? Math.min(25000, (limit + 1) * 5)
      : limit + 1

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
        source: true,
        detectedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
        project: { select: { name: true } },
        owner: { select: { name: true, email: true } },
      },
    })

    const enriched = rows.map((r) => {
      const score = r.probability * r.impact
      return {
        id: r.id,
        projectId: r.projectId,
        projectName: r.project?.name ?? '',
        title: r.title,
        probability: r.probability,
        impact: r.impact,
        score,
        severity: tierFromScore(score),
        status: r.status,
        ownerName: r.owner
          ? `${r.owner.name}${r.owner.email ? ` <${r.owner.email}>` : ''}`
          : '',
        source: r.source,
        detectedAt: isoOrNull(r.detectedAt),
        closedAt: isoOrNull(r.closedAt),
        createdAt: isoOrNull(r.createdAt),
        updatedAt: isoOrNull(r.updatedAt),
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

    void recordAuditEventSafe({
      action: 'tableau.dataset_fetched',
      entityType: 'export',
      metadata: {
        dataset: 'risks',
        rowCount: pageRows.length,
        hasNextPage: nextCursor !== null,
      },
    })

    return tableauJsonResponse({
      table: 'risks',
      rows: pageRows,
      nextCursor,
    })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
