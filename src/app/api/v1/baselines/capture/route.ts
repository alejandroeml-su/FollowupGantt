/**
 * API REST v1 — `POST /api/v1/baselines/capture`.
 *
 * Captura una línea base nueva del proyecto indicado en el body. Replica la
 * lógica de `captureBaseline` server action pero sin pasar por
 * `requireProjectAccess` (que requiere sesión cookie); el token API ya pasó
 * el chequeo de scope `baselines:admin`.
 *
 * Auth: scope `baselines:admin`.
 */

import 'server-only'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { authenticateRequest, requireScope } from '@/lib/api/auth-token'
import { apiOk, apiError, errorResponseFromException } from '@/lib/api/error-response'
import {
  BASELINE_CAP_PER_PROJECT,
  BASELINE_LABEL_MAX,
  buildBaselineSnapshot,
} from '@/lib/scheduling/baseline-snapshot'
import { invalidateBaselinesCache } from '@/lib/actions/baselines'
import { dispatchWebhookEvent } from '@/lib/webhooks/dispatcher'

export const dynamic = 'force-dynamic'

const captureSchema = z.object({
  projectId: z.string().min(1),
  label: z.string().max(BASELINE_LABEL_MAX).optional().nullable(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'baselines:admin')

    const json = await request.json().catch(() => null)
    if (!json) return apiError('INVALID_INPUT', 'Body JSON requerido')

    const parsed = captureSchema.safeParse(json)
    if (!parsed.success) {
      return apiError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    }
    const { projectId } = parsed.data
    const label = parsed.data.label ? parsed.data.label.trim().slice(0, BASELINE_LABEL_MAX) : null

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    })
    if (!project) return apiError('NOT_FOUND', 'El proyecto no existe')

    const existingCount = await prisma.baseline.count({ where: { projectId } })
    if (existingCount >= BASELINE_CAP_PER_PROJECT) {
      return apiError(
        'BASELINE_CAP_REACHED',
        `Máximo ${BASELINE_CAP_PER_PROJECT} líneas base por proyecto`,
      )
    }

    const dbTasks = await prisma.task.findMany({
      where: { projectId, archivedAt: null },
      select: {
        id: true,
        mnemonic: true,
        title: true,
        startDate: true,
        endDate: true,
        plannedValue: true,
        earnedValue: true,
        actualCost: true,
        progress: true,
        status: true,
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    })

    if (dbTasks.length === 0) {
      return apiError('PROJECT_EMPTY', 'El proyecto no tiene tareas para capturar')
    }

    const snapshot = buildBaselineSnapshot({
      tasks: dbTasks,
      capturedAt: new Date(),
      label,
    })

    // Retry simple ante P2002 (duplicado en (projectId, version)).
    const insertOnce = async (): Promise<{ id: string; version: number }> => {
      const last = await prisma.baseline.findFirst({
        where: { projectId },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      const nextVersion = (last?.version ?? 0) + 1
      const created = await prisma.baseline.create({
        data: {
          projectId,
          version: nextVersion,
          label,
          snapshotData: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, version: true },
      })
      return created
    }

    let created: { id: string; version: number }
    try {
      created = await insertOnce()
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Race: reintenta una vez con la versión recalculada.
        created = await insertOnce()
      } else {
        throw err
      }
    }

    await invalidateBaselinesCache(projectId)

    void dispatchWebhookEvent('baseline.captured', {
      id: created.id,
      version: created.version,
      projectId,
      label,
      taskCount: dbTasks.length,
    })

    return apiOk(
      {
        id: created.id,
        version: created.version,
        projectId,
        label,
        taskCount: dbTasks.length,
        capturedAt: new Date().toISOString(),
      },
      { status: 201 },
    )
  } catch (err) {
    return errorResponseFromException(err)
  }
}
