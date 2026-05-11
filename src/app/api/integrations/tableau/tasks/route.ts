/**
 * Wave R3.0 Fase 4 · Equipo P21-B · Tableau Web Data Connector.
 *
 * `GET /api/integrations/tableau/tasks` — tareas del workspace con
 * `projectName`, `sprintName`, `epicName` y `assigneeName` join-eados
 * para que Tableau los muestre directamente sin requerir blends.
 *
 * Query params:
 *   - `projectId`  filtra por proyecto.
 *   - `status`     TaskStatus literal.
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

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:exports')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parseTableauPagination(url)
    const projectId = url.searchParams.get('projectId')
    const status = url.searchParams.get('status')

    const where: Record<string, unknown> = { project: { workspaceId } }
    if (projectId) where.projectId = projectId
    if (status) where.status = status

    const rows = await prisma.task.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        mnemonic: true,
        title: true,
        status: true,
        priority: true,
        storyPoints: true,
        plannedValue: true,
        actualCost: true,
        earnedValue: true,
        progress: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
        projectId: true,
        project: { select: { name: true } },
        sprint: { select: { name: true } },
        epic: { select: { name: true } },
        assignee: { select: { name: true, email: true } },
      },
    })

    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows.pop()
      nextCursor = last?.id ?? null
    }

    const mapped = rows.map((t) => ({
      id: t.id,
      mnemonic: t.mnemonic ?? '',
      title: t.title,
      projectId: t.projectId,
      projectName: t.project?.name ?? '',
      sprintName: t.sprint?.name ?? '',
      epicName: t.epic?.name ?? '',
      assigneeName: t.assignee
        ? `${t.assignee.name}${t.assignee.email ? ` <${t.assignee.email}>` : ''}`
        : '',
      status: t.status,
      priority: t.priority,
      storyPoints: t.storyPoints,
      plannedValue: t.plannedValue,
      actualCost: t.actualCost,
      earnedValue: t.earnedValue,
      progress: t.progress,
      startDate: isoOrNull(t.startDate),
      endDate: isoOrNull(t.endDate),
      createdAt: isoOrNull(t.createdAt),
      updatedAt: isoOrNull(t.updatedAt),
    }))

    void recordAuditEventSafe({
      action: 'tableau.dataset_fetched',
      entityType: 'export',
      metadata: {
        dataset: 'tasks',
        rowCount: mapped.length,
        hasNextPage: nextCursor !== null,
      },
    })

    return tableauJsonResponse({ table: 'tasks', rows: mapped, nextCursor })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
