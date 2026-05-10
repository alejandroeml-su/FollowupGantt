/**
 * Wave P17-B · API v2 — `POST /api/v2/projects/{id}/tasks`.
 *
 * Crea una task dentro del proyecto. Despacha webhook v2 `task.created`.
 *
 * Scope: `write:tasks`.
 */

import 'server-only'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import {
  apiV2Ok,
  apiV2Error,
  errorResponseFromException,
} from '@/lib/api/v2-response'
import { requireApiKey } from '@/app/api/v2/_helpers'
import { dispatchEvent } from '@/lib/webhooks-out/dispatcher'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  // Valores reales del enum Prisma (no inventes valores fuera del schema).
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  type: z.enum(['AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET']).optional(),
  parentId: z.string().min(1).nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  storyPoints: z.number().int().nullable().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireApiKey(request, 'write:tasks')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const { id: projectId } = await params

    // Verifica que el proyecto pertenezca al workspace.
    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true, name: true },
    })
    if (!project) return apiV2Error('NOT_FOUND', 'Proyecto no encontrado')

    const json = await request.json().catch(() => null)
    if (!json) return apiV2Error('INVALID_INPUT', 'Body JSON requerido')

    const parsed = createSchema.safeParse(json)
    if (!parsed.success) {
      return apiV2Error(
        'INVALID_INPUT',
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      )
    }
    const input = parsed.data

    // Mnemónico — mismo patrón que `createTask` en `src/lib/actions.ts`.
    const prefix =
      project.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .substring(0, 4)
        .toUpperCase() || 'TASK'
    const count = await prisma.task.count({ where: { projectId } })
    const mnemonic = `${prefix}-${count + 1}`

    const created = await prisma.task.create({
      data: {
        projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'TODO',
        priority: input.priority ?? 'MEDIUM',
        type: input.type ?? 'AGILE_STORY',
        mnemonic,
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.startDate ? { startDate: new Date(input.startDate) } : {}),
        ...(input.endDate ? { endDate: new Date(input.endDate) } : {}),
        ...(input.storyPoints !== undefined && input.storyPoints !== null
          ? { storyPoints: input.storyPoints }
          : {}),
      },
      select: {
        id: true,
        title: true,
        mnemonic: true,
        status: true,
        priority: true,
        type: true,
        projectId: true,
        parentId: true,
        assigneeId: true,
        startDate: true,
        endDate: true,
        createdAt: true,
      },
    })

    // Dispatch webhook v2 fire-and-forget.
    void dispatchEvent({
      workspaceId,
      event: 'task.created',
      payload: created,
    })

    return apiV2Ok(created, { status: 201 })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
