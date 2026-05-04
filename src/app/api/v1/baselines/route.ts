/**
 * API REST v1 — `/api/v1/baselines` (GET — listado global con filtros).
 *
 * Acepta `?projectId=` para filtrar; sin filtro devuelve un 400 (forzamos
 * scope explícito para no exponer todo de una vez en una llamada accidental).
 *
 * Auth: scope `baselines:read`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest, requireScope } from '@/lib/api/auth-token'
import { apiOk, apiError, errorResponseFromException } from '@/lib/api/error-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'baselines:read')

    const projectId = request.nextUrl.searchParams.get('projectId')
    if (!projectId) {
      return apiError(
        'INVALID_INPUT',
        'Parámetro `projectId` requerido. Usa también /api/v1/projects/{id}/baselines.',
      )
    }

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
