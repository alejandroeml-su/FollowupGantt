/**
 * Wave R3.0 Fase 4 · Equipo P21-B · Tableau Web Data Connector.
 *
 * `GET /api/integrations/tableau/projects` — devuelve proyectos del workspace
 * autenticado en JSON Tableau-compat. Lo consume el WDC `public/wdc/sync-tableau.html`
 * en su callback `getData(table, doneCallback)`.
 *
 * Shape de respuesta:
 *   { table: 'projects', rows: ProjectRow[], nextCursor: string | null }
 *
 * Query params:
 *   - `status`       PLANNING | ACTIVE | ON_HOLD | COMPLETED.
 *   - `methodology`  SCRUM | PMI | HYBRID.
 *   - `cursor`       paginación por id asc.
 *   - `limit`        1..5000 (default 5000 — mismo cap que CSV exports #192).
 *
 * Auth: Bearer API key v2 (`sk_<prefix>_<secret>`) con scope `read:exports`.
 * Reutilizamos el helper `requireApiKey` de #192 — NO duplicamos auth logic.
 *
 * Audit: emite `tableau.dataset_fetched` con `dataset='projects'` y la
 * cantidad de filas servidas para forensic / compliance.
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

const VALID_STATUSES = new Set(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'])
const VALID_METHODOLOGIES = new Set(['SCRUM', 'PMI', 'HYBRID'])

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:exports')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parseTableauPagination(url)
    const status = url.searchParams.get('status')
    const methodology = url.searchParams.get('methodology')

    const where: Record<string, unknown> = { workspaceId }
    if (status && VALID_STATUSES.has(status)) where.status = status
    if (methodology && VALID_METHODOLOGIES.has(methodology)) {
      where.methodology = methodology
    }

    // Pedimos `limit + 1` para detectar si hay página siguiente sin un count(*).
    const rows = await prisma.project.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        status: true,
        methodology: true,
        budget: true,
        budgetCurrency: true,
        cpi: true,
        spi: true,
        createdAt: true,
        updatedAt: true,
        manager: { select: { name: true, email: true } },
        area: {
          select: {
            name: true,
            gerencia: { select: { name: true } },
          },
        },
        tasks: {
          select: { startDate: true, endDate: true },
          where: {
            OR: [{ startDate: { not: null } }, { endDate: { not: null } }],
          },
        },
      },
    })

    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows.pop()
      nextCursor = last?.id ?? null
    }

    const mapped = rows.map((p) => {
      const starts = p.tasks
        .map((t) => t.startDate?.getTime())
        .filter((n): n is number => typeof n === 'number')
      const ends = p.tasks
        .map((t) => t.endDate?.getTime())
        .filter((n): n is number => typeof n === 'number')
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        methodology: p.methodology,
        manager: p.manager
          ? `${p.manager.name}${p.manager.email ? ` <${p.manager.email}>` : ''}`
          : '',
        gerencia: p.area?.gerencia?.name ?? '',
        area: p.area?.name ?? '',
        budget: p.budget ? Number(p.budget.toString()) : null,
        budgetCurrency: p.budgetCurrency,
        cpi: p.cpi,
        spi: p.spi,
        startDate: isoOrNull(starts.length ? new Date(Math.min(...starts)) : null),
        endDate: isoOrNull(ends.length ? new Date(Math.max(...ends)) : null),
        createdAt: isoOrNull(p.createdAt),
        updatedAt: isoOrNull(p.updatedAt),
      }
    })

    // Audit fire-and-forget — `recordAuditEventSafe` swallow + console.error.
    void recordAuditEventSafe({
      action: 'tableau.dataset_fetched',
      entityType: 'export',
      metadata: {
        dataset: 'projects',
        rowCount: mapped.length,
        hasNextPage: nextCursor !== null,
      },
    })

    return tableauJsonResponse({ table: 'projects', rows: mapped, nextCursor })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
