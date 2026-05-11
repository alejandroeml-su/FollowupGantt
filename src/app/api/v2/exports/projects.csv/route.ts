/**
 * Wave R3.0 Fase 4.2 · BI Export Connector.
 *
 * `GET /api/v2/exports/projects.csv` — exporta proyectos del workspace
 * autenticado en formato CSV consumible por Tableau, PowerBI, Looker
 * Studio o Excel (Power Query).
 *
 * Columnas:
 *   id, name, status, methodology, manager, gerencia, area, startDate,
 *   endDate, budget, budgetCurrency, cpi, spi, createdAt, updatedAt.
 *
 * Query params:
 *   - `status`       PLANNING | ACTIVE | ON_HOLD | COMPLETED
 *   - `methodology`  SCRUM | PMI | HYBRID
 *   - `cursor`       paginación por id asc.
 *   - `limit`        1..5000 (default 5000).
 *
 * `startDate`/`endDate` se derivan del min/max de tasks (no existen como
 * columnas dedicadas en `Project`). Manager se reporta como `name <email>`
 * para legibilidad humana en el BI tool.
 *
 * Scope: `read:exports`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponseFromException } from '@/lib/api/v2-response'
import { requireApiKey } from '@/app/api/v2/_helpers'
import { csvResponse, parseCsvPagination, type CsvColumn } from '@/lib/api/csv-writer'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'])
const VALID_METHODOLOGIES = new Set(['SCRUM', 'PMI', 'HYBRID'])

type ProjectRow = {
  id: string
  name: string
  status: string
  methodology: string
  manager: string
  gerencia: string
  area: string
  startDate: Date | null
  endDate: Date | null
  budget: string | null
  budgetCurrency: string | null
  cpi: number | null
  spi: number | null
  createdAt: Date
  updatedAt: Date
}

const COLUMNS: ReadonlyArray<CsvColumn<ProjectRow>> = [
  { header: 'id', value: (r) => r.id },
  { header: 'name', value: (r) => r.name },
  { header: 'status', value: (r) => r.status },
  { header: 'methodology', value: (r) => r.methodology },
  { header: 'manager', value: (r) => r.manager },
  { header: 'gerencia', value: (r) => r.gerencia },
  { header: 'area', value: (r) => r.area },
  { header: 'startDate', value: (r) => r.startDate },
  { header: 'endDate', value: (r) => r.endDate },
  { header: 'budget', value: (r) => r.budget },
  { header: 'budgetCurrency', value: (r) => r.budgetCurrency },
  { header: 'cpi', value: (r) => r.cpi },
  { header: 'spi', value: (r) => r.spi },
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

    const status = url.searchParams.get('status')
    const methodology = url.searchParams.get('methodology')

    const where: Record<string, unknown> = { workspaceId }
    if (status && VALID_STATUSES.has(status)) where.status = status
    if (methodology && VALID_METHODOLOGIES.has(methodology)) where.methodology = methodology

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

    const mapped: ProjectRow[] = rows.map((p) => {
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
        startDate: starts.length ? new Date(Math.min(...starts)) : null,
        endDate: ends.length ? new Date(Math.max(...ends)) : null,
        budget: p.budget ? p.budget.toString() : null,
        budgetCurrency: p.budgetCurrency,
        cpi: p.cpi,
        spi: p.spi,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }
    })

    return csvResponse({
      entity: 'projects',
      columns: COLUMNS,
      rows: mapped,
      nextCursorHeader: nextCursor,
    })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
