/**
 * API REST v1 — `/api/v1/tasks/{id}` (GET, PUT, DELETE).
 *
 * Auth: scope `tasks:read` (GET) o `tasks:write` (PUT/DELETE).
 */

import 'server-only'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest, requireScope } from '@/lib/api/auth-token'
import { apiOk, apiError, errorResponseFromException } from '@/lib/api/error-response'
import { dispatchWebhookEvent } from '@/lib/webhooks/dispatcher'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  type: z.enum(['AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET']).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
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
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
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
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!task) return apiError('NOT_FOUND', 'Tarea no encontrada')
    return apiOk(task)
  } catch (err) {
    return errorResponseFromException(err)
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'tasks:write')
    const { id } = await params

    const json = await request.json().catch(() => null)
    if (!json) return apiError('INVALID_INPUT', 'Body JSON requerido')

    const parsed = updateSchema.safeParse(json)
    if (!parsed.success) {
      return apiError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    }
    if (Object.keys(parsed.data).length === 0) {
      return apiError('INVALID_INPUT', 'Debe enviar al menos un campo')
    }

    const existing = await prisma.task.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) return apiError('NOT_FOUND', 'Tarea no encontrada')

    const data: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.startDate !== undefined) {
      data.startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : null
    }
    if (parsed.data.endDate !== undefined) {
      data.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null
    }

    const updated = await prisma.task.update({
      where: { id },
      data,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        progress: true,
        startDate: true,
        endDate: true,
        updatedAt: true,
      },
    })

    void dispatchWebhookEvent('task.updated', updated)

    return apiOk(updated)
  } catch (err) {
    return errorResponseFromException(err)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'tasks:write')
    const { id } = await params

    const existing = await prisma.task.findUnique({
      where: { id },
      select: { id: true, title: true },
    })
    if (!existing) return apiError('NOT_FOUND', 'Tarea no encontrada')

    await prisma.task.delete({ where: { id } })

    void dispatchWebhookEvent('task.deleted', { id, title: existing.title })

    return apiOk({ id, deleted: true })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
