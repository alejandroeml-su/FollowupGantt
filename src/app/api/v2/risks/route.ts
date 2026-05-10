/**
 * Wave P17-B · API v2 — `GET /api/v2/risks`.
 *
 * Lista riesgos del workspace con filtros opcionales. Incluye el `tier`
 * derivado (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`) — la BD persiste solo
 * `probability` × `impact` (D-RISK-1).
 *
 * Query params:
 *   - `cursor`     paginación.
 *   - `limit`      1..100 (default 50).
 *   - `projectId`  filtra por proyecto.
 *   - `severity`   filtra por tier ∈ {LOW, MEDIUM, HIGH, CRITICAL}.
 *
 * Scope: `read:risks`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { apiV2Ok, errorResponseFromException } from '@/lib/api/v2-response'
import { requireApiKey, parsePagination } from '@/app/api/v2/_helpers'
import { tierFromScore } from '@/lib/risks/risk-score'

export const dynamic = 'force-dynamic'

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
type Severity = (typeof SEVERITIES)[number]
const SEVERITY_SET = new Set<string>(SEVERITIES)

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:risks')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parsePagination(url)
    const projectId = url.searchParams.get('projectId')
    const severityRaw = url.searchParams.get('severity')
    const severityFilter: Severity | null =
      severityRaw && SEVERITY_SET.has(severityRaw) ? (severityRaw as Severity) : null

    // Filtro base por workspace (los risks pertenecen a un proyecto, que
    // pertenece al workspace) — usamos `project: { workspaceId }` para
    // evitar agregar workspaceId a Risk.
    const where: Record<string, unknown> = {
      project: { workspaceId },
    }
    if (projectId) where.projectId = projectId

    // No podemos filtrar por `tier` en BD (se computa); traemos un buffer
    // y filtramos en memoria. Para mantener la cardinalidad del cursor,
    // si hay severity-filter pedimos un poco más y limitamos al final.
    const fetchLimit = severityFilter ? Math.min(500, (limit + 1) * 5) : limit + 1

    const [total, rows] = await Promise.all([
      prisma.risk.count({ where }),
      prisma.risk.findMany({
        where,
        orderBy: { id: 'asc' },
        take: fetchLimit,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          projectId: true,
          title: true,
          description: true,
          probability: true,
          impact: true,
          status: true,
          ownerId: true,
          mitigation: true,
          taskId: true,
          detectedAt: true,
          closedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ])

    const enriched = rows.map((r) => {
      const score = r.probability * r.impact
      return { ...r, score, severity: tierFromScore(score) }
    })

    const filtered = severityFilter
      ? enriched.filter((r) => r.severity === severityFilter)
      : enriched

    let nextCursor: string | null = null
    let pageRows = filtered
    if (filtered.length > limit) {
      pageRows = filtered.slice(0, limit)
      nextCursor = pageRows[pageRows.length - 1]?.id ?? null
    }

    return apiV2Ok(pageRows, { meta: { cursor: nextCursor, total } })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
