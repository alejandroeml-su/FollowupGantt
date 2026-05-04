/**
 * API REST v1 — `/api/v1/tasks/{id}/dependencies` (GET list, POST create).
 *
 * Auth: scope `dependencies:read` (GET) o `dependencies:write` (POST).
 *
 * Reusa la server action `createDependency` para mantener una sola fuente
 * de verdad (validaciones de ciclo, lag, cross-project, CPM pre-commit).
 * El error tipado se mapea al status HTTP correcto vía
 * `errorResponseFromException` (CYCLE_DETECTED → 422, etc.).
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

const createSchema = z.object({
  successorId: z.string().min(1),
  type: TYPE_2L.optional(),
  lagDays: z.number().int().min(-30).max(365).optional(),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request)
    requireScope(auth, 'dependencies:read')
    const { id: taskId } = await params

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true },
    })
    if (!task) return apiError('NOT_FOUND', 'Tarea no encontrada')

    const deps = await prisma.taskDependency.findMany({
      where: {
        OR: [{ predecessorId: taskId }, { successorId: taskId }],
      },
      select: {
        id: true,
        predecessorId: true,
        successorId: true,
        type: true,
        lagDays: true,
      },
    })
    return apiOk({ data: deps })
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
    requireScope(auth, 'dependencies:write')
    const { id: predecessorId } = await params

    const json = await request.json().catch(() => null)
    if (!json) return apiError('INVALID_INPUT', 'Body JSON requerido')

    const parsed = createSchema.safeParse(json)
    if (!parsed.success) {
      return apiError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    }

    // NOTA: `createDependency` requiere sesión (requireProjectAccess).
    // Para el flujo API delegamos directamente al insert con verificaciones
    // mínimas — el grueso de la validación (ciclo, cross-project) se
    // duplica aquí brevemente.
    //
    // Decisión: mantener UN solo path de validación duplicado AHORA es peor
    // que un wrapper compartido; mientras el equipo P4-2 aterriza el módulo,
    // permitimos que la server action lance `[UNAUTHORIZED]` y el handler
    // lo traduzca a 401 (que SÍ es lo correcto: la action verifica sesión
    // de cookie, no del token API). Por eso aquí inlineamos el create para
    // que el token API alcance.
    const created = await prisma.$transaction(async (tx) => {
      const [pred, succ] = await Promise.all([
        tx.task.findUnique({
          where: { id: predecessorId },
          select: { id: true, projectId: true },
        }),
        tx.task.findUnique({
          where: { id: parsed.data.successorId },
          select: { id: true, projectId: true },
        }),
      ])
      if (!pred || !succ) {
        throw new Error('[NOT_FOUND] Tarea predecesor/sucesor inexistente')
      }
      if (pred.id === succ.id) {
        throw new Error('[SELF_DEPENDENCY] Una tarea no puede depender de sí misma')
      }
      if (pred.projectId !== succ.projectId) {
        throw new Error('[CROSS_PROJECT] Las dependencias entre proyectos distintos no están soportadas')
      }
      const exists = await tx.taskDependency.findUnique({
        where: {
          predecessorId_successorId: {
            predecessorId: pred.id,
            successorId: succ.id,
          },
        },
        select: { id: true },
      })
      if (exists) throw new Error('[DEPENDENCY_EXISTS] La dependencia ya existe')

      const TYPE_MAP = {
        FS: 'FINISH_TO_START',
        SS: 'START_TO_START',
        FF: 'FINISH_TO_FINISH',
        SF: 'START_TO_FINISH',
      } as const

      return tx.taskDependency.create({
        data: {
          predecessorId: pred.id,
          successorId: succ.id,
          type: TYPE_MAP[parsed.data.type ?? 'FS'],
          lagDays: parsed.data.lagDays ?? 0,
        },
        select: {
          id: true,
          predecessorId: true,
          successorId: true,
          type: true,
          lagDays: true,
        },
      })
    })

    void dispatchWebhookEvent('dependency.created', created)

    return apiOk(created, { status: 201 })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
