/**
 * API REST v1 — `/api/v1/dependencies/{id}` (GET, PUT, DELETE).
 *
 * Auth: scope `dependencies:read` (GET) o `dependencies:write` (PUT/DELETE).
 */

import 'server-only'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest, requireScope } from '@/lib/api/auth-token'
import { apiOk, apiError, errorResponseFromException } from '@/lib/api/error-response'
import { dispatchWebhookEvent } from '@/lib/webhooks/dispatcher'

export const dynamic = 'force-dynamic'

const TYPE_2L = z.enum(['FS', 'SS', 'FF', 'SF'])
const TYPE_MAP = {
  FS: 'FINISH_TO_START',
  SS: 'START_TO_START',
  FF: 'FINISH_TO_FINISH',
  SF: 'START_TO_FINISH',
} as const

const updateSchema = z
  .object({
    type: TYPE_2L.optional(),
    lagDays: z.number().int().min(-30).max(365).optional(),
  })
  .refine((v) => v.type !== undefined || v.lagDays !== undefined, {
    message: 'Debe especificar al menos type o lagDays',
  })

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'dependencies:read')
    const { id } = await params

    const dep = await prisma.taskDependency.findUnique({
      where: { id },
      select: {
        id: true,
        predecessorId: true,
        successorId: true,
        type: true,
        lagDays: true,
      },
    })
    if (!dep) return apiError('NOT_FOUND', 'Dependencia no encontrada')
    return apiOk(dep)
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
    requireScope(auth, 'dependencies:write')
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

    const existing = await prisma.taskDependency.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) return apiError('NOT_FOUND', 'Dependencia no encontrada')

    const data: { type?: typeof TYPE_MAP[keyof typeof TYPE_MAP]; lagDays?: number } = {}
    if (parsed.data.type !== undefined) data.type = TYPE_MAP[parsed.data.type]
    if (parsed.data.lagDays !== undefined) data.lagDays = parsed.data.lagDays

    const updated = await prisma.taskDependency.update({
      where: { id },
      data,
      select: {
        id: true,
        predecessorId: true,
        successorId: true,
        type: true,
        lagDays: true,
      },
    })
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
    requireScope(auth, 'dependencies:write')
    const { id } = await params

    const existing = await prisma.taskDependency.findUnique({
      where: { id },
      select: { id: true, predecessorId: true, successorId: true },
    })
    if (!existing) return apiError('NOT_FOUND', 'Dependencia no encontrada')

    await prisma.taskDependency.delete({ where: { id } })

    void dispatchWebhookEvent('dependency.deleted', {
      id,
      predecessorId: existing.predecessorId,
      successorId: existing.successorId,
    })

    return apiOk({ id, deleted: true })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
