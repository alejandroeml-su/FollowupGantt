/**
 * API REST v1 — `/api/v1/projects/{id}/tasks` (GET list, POST create).
 *
 * Auth: scope `tasks:read` (GET) o `tasks:write` (POST).
 * Filtros opcionales: ?status=DONE, ?assigneeId=..., ?archived=false (default).
 */

import 'server-only'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest, requireScope } from '@/lib/api/auth-token'
import { apiOk, apiError, errorResponseFromException } from '@/lib/api/error-response'
import { dispatchWebhookEvent } from '@/lib/webhooks/dispatcher'

export const dynamic = 'force-dynamic'

const createTaskSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  type: z.enum(['AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET']).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  parentId: z.string().min(1).nullable().optional(),
  phaseId: z.string().min(1).nullable().optional(),
  sprintId: z.string().min(1).nullable().optional(),
  columnId: z.string().min(1).nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  isMilestone: z.boolean().optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
  tags: z.array(z.string()).optional(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'tasks:read')
    const { id: projectId } = await params

    const url = request.nextUrl
    const status = url.searchParams.get('status')
    const assigneeId = url.searchParams.get('assigneeId')
    const archived = url.searchParams.get('archived') === 'true'

    const where: Record<string, unknown> = { projectId }
    if (!archived) where.archivedAt = null
    if (status) where.status = status
    if (assigneeId) where.assigneeId = assigneeId

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        mnemonic: true,
        title: true,
        description: true,
        type: true,
        status: true,
        priority: true,
        parentId: true,
        projectId: true,
        phaseId: true,
        sprintId: true,
        columnId: true,
        assigneeId: true,
        startDate: true,
        endDate: true,
        progress: true,
        isMilestone: true,
        storyPoints: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return apiOk({ data: tasks })
  } catch (err) {
    return errorResponseFromException(err)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'tasks:write')
    const { id: projectId } = await params

    // Verificamos que el proyecto exista para devolver 404 explícito en
    // lugar del FK violation P2003 (que mapearía a 500).
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    })
    if (!project) return apiError('NOT_FOUND', 'Proyecto no encontrado')

    const json = await request.json().catch(() => null)
    if (!json) return apiError('INVALID_INPUT', 'Body JSON requerido')

    const parsed = createTaskSchema.safeParse(json)
    if (!parsed.success) {
      return apiError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    }

    const data = parsed.data
    const created = await prisma.task.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        status: data.status,
        priority: data.priority,
        projectId,
        parentId: data.parentId ?? null,
        phaseId: data.phaseId ?? null,
        sprintId: data.sprintId ?? null,
        columnId: data.columnId ?? null,
        assigneeId: data.assigneeId ?? null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        progress: data.progress,
        isMilestone: data.isMilestone,
        storyPoints: data.storyPoints ?? null,
        tags: data.tags ?? [],
      },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        status: true,
        priority: true,
        projectId: true,
        startDate: true,
        endDate: true,
        progress: true,
        isMilestone: true,
        storyPoints: true,
        tags: true,
        createdAt: true,
      },
    })

    void dispatchWebhookEvent('task.created', created)

    return apiOk(created, { status: 201 })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
