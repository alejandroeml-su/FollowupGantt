/**
 * Wave P17-B · API v2 — `GET /api/v2/projects`.
 *
 * Lista proyectos del workspace asociado al API key autenticada.
 *
 * Query params:
 *   - `cursor`       paginación cursor por id (asc).
 *   - `limit`        1..100 (default 50).
 *   - `status`       filtra por status (PLANNING/ACTIVE/ON_HOLD/COMPLETED).
 *   - `methodology`  filtra por methodology (SCRUM/PMI/HYBRID).
 *
 * Scope: `read:projects`.
 *
 * Response shape: `{ data: Project[], meta: { cursor, total } }`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { apiV2Ok, errorResponseFromException } from '@/lib/api/v2-response'
import { requireApiKey, parsePagination } from '@/app/api/v2/_helpers'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'])
const VALID_METHODOLOGIES = new Set(['SCRUM', 'PMI', 'HYBRID'])

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:projects')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parsePagination(url)

    const status = url.searchParams.get('status')
    const methodology = url.searchParams.get('methodology')

    const where: Record<string, unknown> = { workspaceId }
    if (status && VALID_STATUSES.has(status)) where.status = status
    if (methodology && VALID_METHODOLOGIES.has(methodology)) where.methodology = methodology

    // total con el filtro (sin cursor) para meta.
    const total = await prisma.project.count({ where })

    const rows = await prisma.project.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        methodology: true,
        areaId: true,
        managerId: true,
        cpi: true,
        spi: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows.pop()
      nextCursor = last?.id ?? null
    }

    return apiV2Ok(rows, { meta: { cursor: nextCursor, total } })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
