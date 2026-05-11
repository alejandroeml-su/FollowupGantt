/**
 * Wave R3.0 Fase 4.2 · BI Export Connector.
 *
 * `GET /api/v2/exports/tasks.csv` — exporta tareas del workspace.
 *
 * Columnas:
 *   id, mnemonic, title, project, projectId, sprint, epic, assignee,
 *   status, priority, storyPoints, plannedValue, actualCost, earnedValue,
 *   progress, startDate, endDate, createdAt, updatedAt.
 *
 * Query params:
 *   - `projectId`  filtra por proyecto.
 *   - `assigneeId` filtra por asignado.
 *   - `status`     TaskStatus literal.
 *   - `cursor`     paginación por id asc.
 *   - `limit`      1..5000 (default 5000).
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

type TaskRow = {
  id: string
  mnemonic: string | null
  title: string
  project: string
  projectId: string
  sprint: string
  epic: string
  assignee: string
  status: string
  priority: string
  storyPoints: number | null
  plannedValue: number | null
  actualCost: number | null
  earnedValue: number | null
  progress: number
  startDate: Date | null
  endDate: Date | null
  createdAt: Date
  updatedAt: Date
}

const COLUMNS: ReadonlyArray<CsvColumn<TaskRow>> = [
  { header: 'id', value: (r) => r.id },
  { header: 'mnemonic', value: (r) => r.mnemonic },
  { header: 'title', value: (r) => r.title },
  { header: 'project', value: (r) => r.project },
  { header: 'projectId', value: (r) => r.projectId },
  { header: 'sprint', value: (r) => r.sprint },
  { header: 'epic', value: (r) => r.epic },
  { header: 'assignee', value: (r) => r.assignee },
  { header: 'status', value: (r) => r.status },
  { header: 'priority', value: (r) => r.priority },
  { header: 'storyPoints', value: (r) => r.storyPoints },
  { header: 'plannedValue', value: (r) => r.plannedValue },
  { header: 'actualCost', value: (r) => r.actualCost },
  { header: 'earnedValue', value: (r) => r.earnedValue },
  { header: 'progress', value: (r) => r.progress },
  { header: 'startDate', value: (r) => r.startDate },
  { header: 'endDate', value: (r) => r.endDate },
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
    const assigneeId = url.searchParams.get('assigneeId')
    const status = url.searchParams.get('status')

    const where: Record<string, unknown> = {
      project: { workspaceId },
    }
    if (projectId) where.projectId = projectId
    if (assigneeId) where.assigneeId = assigneeId
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

    const mapped: TaskRow[] = rows.map((t) => ({
      id: t.id,
      mnemonic: t.mnemonic,
      title: t.title,
      project: t.project?.name ?? '',
      projectId: t.projectId,
      sprint: t.sprint?.name ?? '',
      epic: t.epic?.name ?? '',
      assignee: t.assignee
        ? `${t.assignee.name}${t.assignee.email ? ` <${t.assignee.email}>` : ''}`
        : '',
      status: t.status,
      priority: t.priority,
      storyPoints: t.storyPoints,
      plannedValue: t.plannedValue,
      actualCost: t.actualCost,
      earnedValue: t.earnedValue,
      progress: t.progress,
      startDate: t.startDate,
      endDate: t.endDate,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))

    return csvResponse({
      entity: 'tasks',
      columns: COLUMNS,
      rows: mapped,
      nextCursorHeader: nextCursor,
    })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
