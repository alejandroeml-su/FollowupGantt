/**
 * Wave R3.0 Fase 4 · Equipo P21-B · Tableau Web Data Connector.
 *
 * `GET /api/integrations/tableau/sprints` — sprints del workspace con
 * `projectName` joined y un campo derivado `state`:
 *   - `PLANNING` si `startedAt` es null.
 *   - `ACTIVE`   si `startedAt` no-null y `endedAt` null.
 *   - `CLOSED`   si `endedAt` no-null.
 *
 * Esto evita exponer el enum `ProjectStatus` (que en BD se reusa para
 * sprint.status sin semántica plena) y le da a Tableau un eje filtrable.
 *
 * Query params:
 *   - `projectId`  filtra por proyecto.
 *   - `state`      PLANNING | ACTIVE | CLOSED (post-filtro en memoria
 *                   porque es derivado).
 *   - `cursor`     paginación por id asc.
 *   - `limit`      1..5000 (default 5000).
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

export const dynamic = 'force-dynamic'

const VALID_STATES = new Set(['PLANNING', 'ACTIVE', 'CLOSED'])

type SprintState = 'PLANNING' | 'ACTIVE' | 'CLOSED'

function deriveState(startedAt: Date | null, endedAt: Date | null): SprintState {
  if (endedAt) return 'CLOSED'
  if (startedAt) return 'ACTIVE'
  return 'PLANNING'
}

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:exports')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parseTableauPagination(url)
    const projectId = url.searchParams.get('projectId')
    const stateRaw = url.searchParams.get('state')
    const stateFilter: SprintState | null =
      stateRaw && VALID_STATES.has(stateRaw) ? (stateRaw as SprintState) : null

    const where: Record<string, unknown> = { project: { workspaceId } }
    if (projectId) where.projectId = projectId

    // Si hay filtro de state (derivado, no es columna), buscamos un buffer
    // mayor — mismo patrón que `/api/v2/exports/risks.csv` con severity.
    const fetchLimit = stateFilter ? Math.min(25000, (limit + 1) * 5) : limit + 1

    const rows = await prisma.sprint.findMany({
      where,
      orderBy: { id: 'asc' },
      take: fetchLimit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        goal: true,
        startDate: true,
        endDate: true,
        startedAt: true,
        endedAt: true,
        reviewedAt: true,
        capacity: true,
        velocityActual: true,
        projectId: true,
        project: { select: { name: true } },
      },
    })

    const mappedAll = rows.map((s) => ({
      id: s.id,
      name: s.name,
      goal: s.goal ?? '',
      projectId: s.projectId,
      projectName: s.project?.name ?? '',
      state: deriveState(s.startedAt, s.endedAt),
      capacity: s.capacity,
      velocityActual: s.velocityActual,
      startDate: isoOrNull(s.startDate),
      endDate: isoOrNull(s.endDate),
      startedAt: isoOrNull(s.startedAt),
      endedAt: isoOrNull(s.endedAt),
      reviewedAt: isoOrNull(s.reviewedAt),
    }))

    const filtered = stateFilter
      ? mappedAll.filter((r) => r.state === stateFilter)
      : mappedAll

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
        dataset: 'sprints',
        rowCount: pageRows.length,
        hasNextPage: nextCursor !== null,
      },
    })

    return tableauJsonResponse({
      table: 'sprints',
      rows: pageRows,
      nextCursor,
    })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
