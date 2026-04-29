'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { DependencyType as PrismaDependencyType } from '@prisma/client'
import prisma from '@/lib/prisma'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'
import { wouldCreateCycle } from '@/lib/scheduling/cycle'

// ───────────────────────── Errores tipados ─────────────────────────
//
// Convención del repo: `[CODE] detalle legible`. El cliente parsea el
// código con regex y mapea a UX (toast). Los códigos NO son user-facing,
// el detalle sí.

export type DependencyErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'SELF_DEPENDENCY'
  | 'CROSS_PROJECT'
  | 'DEPENDENCY_EXISTS'
  | 'CYCLE_DETECTED'

function actionError(code: DependencyErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const DEP_TYPE_2L_TO_PRISMA: Record<
  'FS' | 'SS' | 'FF' | 'SF',
  PrismaDependencyType
> = {
  FS: 'FINISH_TO_START',
  SS: 'START_TO_START',
  FF: 'FINISH_TO_FINISH',
  SF: 'START_TO_FINISH',
}

const createSchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
  lagDays: z.number().int().default(0).optional(),
})

export type CreateDependencyInput = z.input<typeof createSchema>

// ───────────────────────── Server actions ─────────────────────────

/**
 * Crea una dependencia entre dos tareas. Validaciones (en orden):
 *
 *   1. Esquema (zod): ids no vacíos, type válido, lag entero.
 *   2. `predecessorId !== successorId` → `[SELF_DEPENDENCY]`.
 *   3. Ambas tareas existen en BD → `[NOT_FOUND]`.
 *   4. Ambas pertenecen al mismo proyecto → `[CROSS_PROJECT]`.
 *      D-?? aún no decidida formalmente: por ahora bloqueamos el caso
 *      cross-project porque el CPM trabaja por proyecto. Si Edwin lo
 *      pide explícitamente, relajar esta restricción.
 *   5. La dependencia no existe ya → `[DEPENDENCY_EXISTS]`.
 *   6. No genera ciclo → `[CYCLE_DETECTED]` (DFS sobre deps del proyecto).
 *
 * Tras `prisma.taskDependency.create`:
 *   - Invalida cache CPM del proyecto.
 *   - `revalidatePath('/gantt')` para que la siguiente carga vea la flecha.
 */
export async function createDependency(
  input: CreateDependencyInput,
): Promise<{ id: string }> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { predecessorId, successorId, type, lagDays = 0 } = parsed.data

  if (predecessorId === successorId) {
    actionError('SELF_DEPENDENCY', 'Una tarea no puede depender de sí misma')
  }

  const [pred, succ] = await Promise.all([
    prisma.task.findUnique({
      where: { id: predecessorId },
      select: { id: true, projectId: true },
    }),
    prisma.task.findUnique({
      where: { id: successorId },
      select: { id: true, projectId: true },
    }),
  ])
  if (!pred) actionError('NOT_FOUND', 'predecesor inexistente')
  if (!succ) actionError('NOT_FOUND', 'sucesor inexistente')

  if (pred.projectId !== succ.projectId) {
    actionError(
      'CROSS_PROJECT',
      'Las dependencias entre proyectos distintos no están soportadas',
    )
  }

  // Carga deps del proyecto para validar duplicado y ciclo en una sola
  // query (más barato que dos round-trips).
  const projectTaskIds = await prisma.task.findMany({
    where: { projectId: pred.projectId, archivedAt: null },
    select: { id: true },
  })
  const idSet = new Set(projectTaskIds.map((t) => t.id))
  const projectDeps = await prisma.taskDependency.findMany({
    where: {
      AND: [
        { predecessorId: { in: [...idSet] } },
        { successorId: { in: [...idSet] } },
      ],
    },
    select: { predecessorId: true, successorId: true },
  })

  const exists = projectDeps.some(
    (d) => d.predecessorId === predecessorId && d.successorId === successorId,
  )
  if (exists) {
    actionError('DEPENDENCY_EXISTS', 'La dependencia ya existe')
  }

  if (wouldCreateCycle(projectDeps, predecessorId, successorId)) {
    actionError('CYCLE_DETECTED', 'La dependencia generaría un ciclo')
  }

  const created = await prisma.taskDependency.create({
    data: {
      predecessorId,
      successorId,
      type: DEP_TYPE_2L_TO_PRISMA[type],
      lagDays: lagDays ?? 0,
    },
    select: { id: true },
  })

  invalidateCpmCache(pred.projectId)
  revalidatePath('/gantt')
  return created
}

/**
 * Elimina una dependencia por ids (predecessor, successor). Idempotente:
 * si ya no existe, no lanza. Útil para acción "delete" del modal.
 */
export async function deleteDependency(input: {
  predecessorId: string
  successorId: string
}): Promise<{ ok: true }> {
  if (!input.predecessorId || !input.successorId) {
    actionError('INVALID_INPUT', 'ids requeridos')
  }

  // Necesitamos el projectId para invalidar cache. Si la dep ya no existe,
  // hacemos no-op.
  const dep = await prisma.taskDependency.findUnique({
    where: {
      predecessorId_successorId: {
        predecessorId: input.predecessorId,
        successorId: input.successorId,
      },
    },
    select: { predecessor: { select: { projectId: true } } },
  })
  if (!dep) return { ok: true as const }

  await prisma.taskDependency.delete({
    where: {
      predecessorId_successorId: {
        predecessorId: input.predecessorId,
        successorId: input.successorId,
      },
    },
  })

  invalidateCpmCache(dep.predecessor.projectId)
  revalidatePath('/gantt')
  return { ok: true as const }
}
