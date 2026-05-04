/**
 * API REST v1 — `/api/v1/projects/{id}/baselines` (GET list).
 * POST capture vive en `/api/v1/baselines/capture` para alinearse con la
 * convención de "acción remota" del equipo P0-3.
 *
 * Auth: scope `baselines:read`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest, requireScope } from '@/lib/api/auth-token'
import { apiOk, apiError, errorResponseFromException } from '@/lib/api/error-response'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'baselines:read')
    const { id: projectId } = await params

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    })
    if (!project) return apiError('NOT_FOUND', 'Proyecto no encontrado')

    const rows = await prisma.baseline.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        label: true,
        createdAt: true,
        snapshotData: true,
      },
    })

    const data = rows.map((r) => {
      const snap = r.snapshotData as { tasks?: unknown[] } | null
      const taskCount = Array.isArray(snap?.tasks) ? snap.tasks.length : 0
      return {
        id: r.id,
        version: r.version,
        label: r.label,
        capturedAt: r.createdAt.toISOString(),
        taskCount,
      }
    })

    return apiOk({ data })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
