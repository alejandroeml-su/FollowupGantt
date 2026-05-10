/**
 * Wave P17-B · API v2 — `GET /api/v2/projects/{id}`.
 *
 * Devuelve el proyecto con phases inline + count de tasks. Solo si el
 * proyecto pertenece al workspace de la API key.
 *
 * Scope: `read:projects`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { apiV2Ok, apiV2Error, errorResponseFromException } from '@/lib/api/v2-response'
import { requireApiKey } from '@/app/api/v2/_helpers'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireApiKey(request, 'read:projects')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const { id } = await params

    const project = await prisma.project.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        methodology: true,
        areaId: true,
        managerId: true,
        cpi: true,
        spi: true,
        createdAt: true,
        updatedAt: true,
        phases: {
          select: { id: true, name: true, order: true },
          orderBy: { order: 'asc' },
        },
        _count: { select: { tasks: true } },
      },
    })
    if (!project) return apiV2Error('NOT_FOUND', 'Proyecto no encontrado')

    const { _count, ...rest } = project
    return apiV2Ok({ ...rest, tasksCount: _count.tasks })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
