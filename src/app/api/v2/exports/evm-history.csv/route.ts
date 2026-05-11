/**
 * Wave R3.0 Fase 4.2 · BI Export Connector.
 *
 * `GET /api/v2/exports/evm-history.csv` — exporta el histórico de
 * `EVMSnapshot` para que herramientas externas dibujen curvas S, EAC
 * vs BAC, CPI/SPI temporales, etc.
 *
 * Columnas:
 *   id, projectId, project, snapshotDate, plannedValue, earnedValue,
 *   actualCost, budgetAtCompletion, cpi, spi, estimateAtCompletion,
 *   varianceAtCompletion, notes, createdAt.
 *
 * Query params:
 *   - `projectId`  filtra por proyecto.
 *   - `since`      ISO-8601 date — solo snapshots con `snapshotDate >= since`.
 *   - `cursor`     paginación por id asc.
 *   - `limit`      1..5000.
 *
 * Scope: `read:exports`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponseFromException, apiV2Error } from '@/lib/api/v2-response'
import { requireApiKey } from '@/app/api/v2/_helpers'
import { csvResponse, parseCsvPagination, type CsvColumn } from '@/lib/api/csv-writer'

export const dynamic = 'force-dynamic'

type EvmRow = {
  id: string
  projectId: string
  project: string
  snapshotDate: Date
  plannedValue: string
  earnedValue: string
  actualCost: string
  budgetAtCompletion: string | null
  cpi: number | null
  spi: number | null
  estimateAtCompletion: string | null
  varianceAtCompletion: string | null
  notes: string | null
  createdAt: Date
}

const COLUMNS: ReadonlyArray<CsvColumn<EvmRow>> = [
  { header: 'id', value: (r) => r.id },
  { header: 'projectId', value: (r) => r.projectId },
  { header: 'project', value: (r) => r.project },
  { header: 'snapshotDate', value: (r) => r.snapshotDate },
  { header: 'plannedValue', value: (r) => r.plannedValue },
  { header: 'earnedValue', value: (r) => r.earnedValue },
  { header: 'actualCost', value: (r) => r.actualCost },
  { header: 'budgetAtCompletion', value: (r) => r.budgetAtCompletion },
  { header: 'cpi', value: (r) => r.cpi },
  { header: 'spi', value: (r) => r.spi },
  { header: 'estimateAtCompletion', value: (r) => r.estimateAtCompletion },
  { header: 'varianceAtCompletion', value: (r) => r.varianceAtCompletion },
  { header: 'notes', value: (r) => r.notes },
  { header: 'createdAt', value: (r) => r.createdAt },
]

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:exports')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parseCsvPagination(url)

    const projectId = url.searchParams.get('projectId')
    const sinceRaw = url.searchParams.get('since')

    let sinceDate: Date | null = null
    if (sinceRaw) {
      const parsed = new Date(sinceRaw)
      if (Number.isNaN(parsed.getTime())) {
        return apiV2Error(
          'INVALID_INPUT',
          'Parámetro `since` debe ser una fecha ISO-8601 válida',
        )
      }
      sinceDate = parsed
    }

    const where: Record<string, unknown> = {
      project: { workspaceId },
    }
    if (projectId) where.projectId = projectId
    if (sinceDate) where.snapshotDate = { gte: sinceDate }

    const rows = await prisma.eVMSnapshot.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        projectId: true,
        snapshotDate: true,
        plannedValue: true,
        earnedValue: true,
        actualCost: true,
        budgetAtCompletion: true,
        cpi: true,
        spi: true,
        estimateAtCompletion: true,
        varianceAtCompletion: true,
        notes: true,
        createdAt: true,
        project: { select: { name: true } },
      },
    })

    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows.pop()
      nextCursor = last?.id ?? null
    }

    const mapped: EvmRow[] = rows.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      project: s.project?.name ?? '',
      snapshotDate: s.snapshotDate,
      plannedValue: s.plannedValue.toString(),
      earnedValue: s.earnedValue.toString(),
      actualCost: s.actualCost.toString(),
      budgetAtCompletion: s.budgetAtCompletion ? s.budgetAtCompletion.toString() : null,
      cpi: s.cpi,
      spi: s.spi,
      estimateAtCompletion: s.estimateAtCompletion
        ? s.estimateAtCompletion.toString()
        : null,
      varianceAtCompletion: s.varianceAtCompletion
        ? s.varianceAtCompletion.toString()
        : null,
      notes: s.notes,
      createdAt: s.createdAt,
    }))

    return csvResponse({
      entity: 'evm-history',
      columns: COLUMNS,
      rows: mapped,
      nextCursorHeader: nextCursor,
    })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
