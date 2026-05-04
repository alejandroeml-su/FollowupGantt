/**
 * API REST v1 — `/api/v1/projects` (GET list, POST create).
 *
 * Auth: Bearer token con scope `projects:read` (GET) o `projects:write` (POST).
 * Convención respuesta:
 *   - 200 GET con array
 *   - 201 POST con el recurso creado
 *   - error: { error: { code, message } }
 */

import 'server-only'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest, requireScope } from '@/lib/api/auth-token'
import { apiOk, errorResponseFromException, apiError } from '@/lib/api/error-response'
import { dispatchWebhookEvent } from '@/lib/webhooks/dispatcher'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED']).optional(),
  areaId: z.string().min(1).optional().nullable(),
  managerId: z.string().min(1).optional().nullable(),
})

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'projects:read')

    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        areaId: true,
        managerId: true,
        cpi: true,
        spi: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return apiOk({ data: projects })
  } catch (err) {
    return errorResponseFromException(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'projects:write')

    const json = await request.json().catch(() => null)
    if (!json) return apiError('INVALID_INPUT', 'Body JSON requerido')

    const parsed = createSchema.safeParse(json)
    if (!parsed.success) {
      return apiError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    }

    const created = await prisma.project.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        status: parsed.data.status,
        areaId: parsed.data.areaId ?? null,
        managerId: parsed.data.managerId ?? null,
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        areaId: true,
        managerId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    void dispatchWebhookEvent('project.created', created)

    return apiOk(created, { status: 201 })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
