/**
 * API REST v1 — `/api/v1/projects/{id}` (GET, PUT, DELETE).
 *
 * Auth: scope `projects:read` (GET) o `projects:write` (PUT/DELETE).
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
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED']).optional(),
  areaId: z.string().min(1).nullable().optional(),
  managerId: z.string().min(1).nullable().optional(),
  calendarId: z.string().min(1).nullable().optional(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'projects:read')

    const { id } = await params
    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        areaId: true,
        managerId: true,
        calendarId: true,
        cpi: true,
        spi: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!project) return apiError('NOT_FOUND', 'Proyecto no encontrado')
    return apiOk(project)
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
    requireScope(auth, 'projects:write')
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

    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) return apiError('NOT_FOUND', 'Proyecto no encontrado')

    const updated = await prisma.project.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        areaId: true,
        managerId: true,
        calendarId: true,
        updatedAt: true,
      },
    })

    void dispatchWebhookEvent('project.updated', updated)

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
    requireScope(auth, 'projects:write')
    const { id } = await params

    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true, name: true },
    })
    if (!existing) return apiError('NOT_FOUND', 'Proyecto no encontrado')

    await prisma.project.delete({ where: { id } })

    void dispatchWebhookEvent('project.deleted', { id, name: existing.name })

    return apiOk({ id, deleted: true })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
