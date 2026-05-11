/**
 * Wave P20-C · Brain Auto-Pilot — Apply / Rollback adapter.
 *
 * Ejecuta las `applyOps` declarativas dentro de una transacción Prisma y
 * devuelve las ops inversas (`rollbackOps`) que el caller persiste en
 * `AutoPilotRun.rollbackOps`. Si alguna op falla durante el apply, NINGUNA
 * se aplica (atomicidad nativa de la transacción).
 *
 * El módulo es agnóstico de auth / audit / revalidate — eso lo hace la
 * server action wrapper (`src/lib/actions/auto-pilot.ts`). Esto permite
 * testarlo con un Prisma mock simple.
 *
 * Decisión D-P20C-3: las ops `task.update` snapshot el valor anterior con
 *   `findUnique` dentro de la misma tx ANTES del update, garantizando que
 *   la rollback op sea consistent-on-read. Otros patrones (read fuera de
 *   tx) abrirían window race en escenarios concurrentes.
 *
 * Errores tipados:
 *   `[AUTO_PILOT_OP_INVALID]`  op fuera del catálogo conocido
 *   `[AUTO_PILOT_TARGET_NOT_FOUND]`  fila apuntada por op no existe
 */

import type { PrismaClient, Prisma } from '@prisma/client'
import type { AutoPilotOp, AutoPilotProposal } from './types'

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

type AdapterDeps = {
  /// Prisma client a usar. Si se pasa, el adapter NO abre transacción nueva
  /// (asume que el caller ya está dentro de una). Si se omite, importa el
  /// singleton de `@/lib/prisma` y abre tx propia.
  prisma?: PrismaClient
}

function err(code: string, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

/// Carga prisma de forma perezosa para que los tests puedan inyectar `deps`
/// sin disparar el singleton (que requiere `DATABASE_URL`).
async function loadPrisma(): Promise<PrismaClient> {
  const mod = await import('@/lib/prisma')
  return mod.default
}

// ─── Apply ──────────────────────────────────────────────────────────

export interface ApplyResult {
  rollbackOps: AutoPilotOp[]
}

/**
 * Ejecuta los `applyOps` del proposal en una transacción y devuelve las
 * ops inversas. Lanza con prefijo `[AUTO_PILOT_*]` si algún target no
 * existe o el `type` está fuera del catálogo.
 */
export async function applyProposal(
  proposal: AutoPilotProposal,
  deps: AdapterDeps = {},
): Promise<ApplyResult> {
  const prisma = deps.prisma ?? (await loadPrisma())

  return prisma.$transaction(async (tx) => {
    const rollbackOps: AutoPilotOp[] = []

    for (const op of proposal.applyOps) {
      const inverse = await applyOne(tx as unknown as Tx, op)
      rollbackOps.push(inverse)
    }

    return { rollbackOps }
  })
}

/**
 * Aplica las ops inversas devueltas por `applyProposal` (típicamente leídas
 * de `AutoPilotRun.rollbackOps`). También transaccional.
 */
export async function rollbackProposal(
  rollbackOps: AutoPilotOp[],
  deps: AdapterDeps = {},
): Promise<void> {
  const prisma = deps.prisma ?? (await loadPrisma())

  await prisma.$transaction(async (tx) => {
    for (const op of rollbackOps) {
      await applyOne(tx as unknown as Tx, op)
    }
  })
}

// ─── Ejecutor por op ────────────────────────────────────────────────

async function applyOne(
  tx: Tx,
  op: AutoPilotOp,
): Promise<AutoPilotOp> {
  switch (op.type) {
    case 'task.update': {
      const current = await tx.task.findUnique({
        where: { id: op.targetId },
        select: { id: true, sprintId: true, assigneeId: true },
      })
      if (!current) {
        err(
          'AUTO_PILOT_TARGET_NOT_FOUND',
          `task ${op.targetId} no existe (op task.update)`,
        )
      }

      const data: Prisma.TaskUncheckedUpdateInput = {}
      const inversePatch: { sprintId?: string | null; assigneeId?: string | null } = {}
      if ('sprintId' in op.patch) {
        data.sprintId = op.patch.sprintId ?? null
        inversePatch.sprintId = current.sprintId
      }
      if ('assigneeId' in op.patch) {
        data.assigneeId = op.patch.assigneeId ?? null
        inversePatch.assigneeId = current.assigneeId
      }

      await tx.task.update({ where: { id: op.targetId }, data })

      return {
        type: 'task.update',
        targetId: op.targetId,
        patch: inversePatch,
      }
    }

    case 'sprint.update': {
      const current = await tx.sprint.findUnique({
        where: { id: op.targetId },
        select: { id: true, endDate: true },
      })
      if (!current) {
        err(
          'AUTO_PILOT_TARGET_NOT_FOUND',
          `sprint ${op.targetId} no existe (op sprint.update)`,
        )
      }

      const inverseEnd = current.endDate.toISOString()
      const data: Prisma.SprintUpdateInput = {}
      if (op.patch.endDate) data.endDate = new Date(op.patch.endDate)

      await tx.sprint.update({ where: { id: op.targetId }, data })

      return {
        type: 'sprint.update',
        targetId: op.targetId,
        patch: { endDate: inverseEnd },
      }
    }

    case 'workspace.upsert_global_template': {
      const rollbackMarker = (op.payload.body as Record<string, unknown> | undefined)?.[
        '__rollback_action__'
      ]

      // Rollback path: 'delete' borra el template creado por el apply
      // original; 'noop' es idempotente (apply original detectó duplicado y
      // no creó nada). `deleteMany` absorbe el caso "ya no existe".
      if (rollbackMarker === 'delete') {
        await tx.globalTemplate.deleteMany({ where: { id: op.targetId } })
        return op
      }
      if (rollbackMarker === 'noop') {
        return op
      }

      const existing = await tx.globalTemplate.findUnique({
        where: { id: op.targetId },
        select: { id: true },
      })

      if (existing) {
        // Idempotencia: si ya existe, no creamos duplicado. La rollback será
        // no-op porque no fuimos quienes lo introdujimos.
        return {
          type: 'workspace.upsert_global_template',
          targetId: op.targetId,
          workspaceId: op.workspaceId,
          payload: {
            ...op.payload,
            body: { ...op.payload.body, __rollback_action__: 'noop' },
          },
        }
      }

      await tx.globalTemplate.create({
        data: {
          id: op.targetId,
          name: op.payload.name,
          kind: op.payload.kind,
          payload: op.payload.body as Prisma.InputJsonValue,
          workspaceId: op.workspaceId,
        },
      })

      return {
        type: 'workspace.upsert_global_template',
        targetId: op.targetId,
        workspaceId: op.workspaceId,
        // Marker para que la rollback dispare el delete.
        payload: {
          ...op.payload,
          body: { ...op.payload.body, __rollback_action__: 'delete' },
        },
      }
    }

    default: {
      // Catch para forzar exhaustiveness — TS detectaría omisiones a futuro.
      const unknown = op as { type?: string }
      err(
        'AUTO_PILOT_OP_INVALID',
        `op desconocida ${String(unknown.type ?? 'undefined')}`,
      )
    }
  }
}
