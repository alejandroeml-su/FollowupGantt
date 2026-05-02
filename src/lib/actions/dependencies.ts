'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { DependencyType as PrismaDependencyType } from '@prisma/client'
import prisma from '@/lib/prisma'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'
import { wouldCreateCycle } from '@/lib/scheduling/cycle'
import { validateScheduledChange } from '@/lib/scheduling/validate'
import { requireProjectAccess } from '@/lib/auth/check-project-access'

// ───────────────────────── Errores tipados ─────────────────────────
//
// Convención del repo: `[CODE] detalle legible`. El cliente parsea el
// código con regex y mapea a UX (toast). Los códigos NO son user-facing,
// el detalle sí.

export type DependencyErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_LAG'
  | 'INVALID_TYPE'
  | 'NOT_FOUND'
  | 'SELF_DEPENDENCY'
  | 'CROSS_PROJECT'
  | 'DEPENDENCY_EXISTS'
  | 'CYCLE_DETECTED'
  | 'NEGATIVE_FLOAT'

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

// Límites de lag/lead expuestos al cliente (también validados aquí). Negativos
// son leads (solapamientos), positivos son lags (esperas). Los límites son
// pragmáticos: un mes de adelanto, un año de espera. Ajustables si el negocio
// lo pide.
const LAG_MIN_DAYS = -30
const LAG_MAX_DAYS = 365

const TWO_LETTER_TYPE = z.enum(['FS', 'SS', 'FF', 'SF'])
const LAG_DAYS_SCHEMA = z
  .number()
  .int()
  .min(LAG_MIN_DAYS)
  .max(LAG_MAX_DAYS)

const createSchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: TWO_LETTER_TYPE.default('FS'),
  lagDays: LAG_DAYS_SCHEMA.default(0).optional(),
})

export type CreateDependencyInput = z.input<typeof createSchema>

const updateSchema = z
  .object({
    id: z.string().min(1),
    type: TWO_LETTER_TYPE.optional(),
    lagDays: LAG_DAYS_SCHEMA.optional(),
  })
  .refine((v) => v.type !== undefined || v.lagDays !== undefined, {
    message: 'Debe especificar al menos `type` o `lagDays`',
  })

export type UpdateDependencyInput = z.input<typeof updateSchema>

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

  // Auth (Ola P1): el usuario debe tener acceso al proyecto compartido.
  await requireProjectAccess(pred.projectId)

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

  // HU-1.5 · Validación CPM pre-commit. La nueva arista podría generar
  // slack negativo aunque no cierre ciclo (p. ej. lag positivo que excede
  // la holgura disponible). `validateScheduledChange` lanza
  // `[NEGATIVE_FLOAT]` o `[CYCLE_DETECTED]` si aplica.
  await validateScheduledChange(pred.projectId, {
    addDependencies: [
      {
        predecessorId,
        successorId,
        type,
        lag: lagDays ?? 0,
      },
    ],
  })

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
 * HU-1.4 · Actualiza tipo y/o lag de una dependencia existente.
 *
 * Validaciones (en orden):
 *   1. Esquema (zod): id no vacío, tipo válido, lag ∈ [-30, 365] enteros, al
 *      menos uno de {type, lagDays} presente.
 *   2. Existe la dep en BD → `[NOT_FOUND]`.
 *   3. Si se cambia el tipo, recalcular ciclos sobre el grafo del proyecto
 *      excluyendo la propia arista (la actualización no debe colisionar consigo
 *      misma) → `[CYCLE_DETECTED]`.
 *
 * D3 confirmada: cambiar tipo NO mueve sucesores. El CPM se recomputa al
 * invalidar el cache del proyecto, pero las fechas reales de Task no se tocan.
 */
export async function updateDependency(
  input: UpdateDependencyInput,
): Promise<{ id: string }> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    // Distinguimos lag fuera de rango como `[INVALID_LAG]` para UX más fina.
    const issues = parsed.error.issues
    const lagIssue = issues.find((i) => i.path[0] === 'lagDays')
    if (lagIssue) {
      actionError('INVALID_LAG', `Lag debe ser entero entre ${LAG_MIN_DAYS} y ${LAG_MAX_DAYS}`)
    }
    const typeIssue = issues.find((i) => i.path[0] === 'type')
    if (typeIssue) {
      actionError('INVALID_TYPE', 'Tipo debe ser FS, SS, FF o SF')
    }
    actionError('INVALID_INPUT', issues.map((i) => i.message).join('; '))
  }
  const { id, type, lagDays } = parsed.data

  const existing = await prisma.taskDependency.findUnique({
    where: { id },
    select: {
      id: true,
      predecessorId: true,
      successorId: true,
      type: true,
      predecessor: { select: { projectId: true } },
    },
  })
  if (!existing) actionError('NOT_FOUND', 'La dependencia no existe')

  const projectId = existing.predecessor.projectId
  if (!projectId) {
    actionError('NOT_FOUND', 'La dependencia carece de proyecto asociado')
  }

  // Auth (Ola P1): solo miembros o admins pueden mutar dependencias.
  await requireProjectAccess(projectId)

  // Si cambia el tipo, revalidar ciclos. SS/FF/SF no introducen aristas en el
  // DAG (la dirección sigue siendo predecessor → successor) pero queda como
  // checkeo defensivo barato y consistente con `createDependency`.
  if (type !== undefined) {
    const projectTaskIds = await prisma.task.findMany({
      where: { projectId, archivedAt: null },
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
      select: { id: true, predecessorId: true, successorId: true },
    })
    // Excluir la propia arista del grafo para que la verificación no la cuente
    // como pre-existente.
    const remaining = projectDeps.filter((d) => d.id !== existing.id)
    if (
      wouldCreateCycle(remaining, existing.predecessorId, existing.successorId)
    ) {
      actionError('CYCLE_DETECTED', 'El cambio generaría un ciclo')
    }
  }

  // HU-1.5 · Validación CPM pre-commit del nuevo tipo/lag. El override
  // mantiene el resto del grafo intacto y reemplaza esta única arista.
  await validateScheduledChange(projectId, {
    updateDependencies: [
      {
        predecessorId: existing.predecessorId,
        successorId: existing.successorId,
        ...(type !== undefined ? { type } : {}),
        ...(lagDays !== undefined ? { lag: lagDays } : {}),
      },
    ],
  })

  const data: { type?: PrismaDependencyType; lagDays?: number } = {}
  if (type !== undefined) data.type = DEP_TYPE_2L_TO_PRISMA[type]
  if (lagDays !== undefined) data.lagDays = lagDays

  const updated = await prisma.taskDependency.update({
    where: { id },
    data,
    select: { id: true },
  })

  invalidateCpmCache(projectId)
  revalidatePath('/gantt')
  return updated
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

  // Auth (Ola P1): chequeo después de localizar el projectId. El no-op
  // anterior cuando la dep no existe se mantiene para preservar
  // idempotencia.
  await requireProjectAccess(dep.predecessor.projectId)

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
