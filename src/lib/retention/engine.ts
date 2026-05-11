import 'server-only'

import {
  Prisma,
  type RetentionDomain,
  type RetentionPolicy,
  type RetentionPurgeStatus,
} from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  RETENTION_BATCH_SIZE,
  RETENTION_SAFETY_CAP,
} from '@/lib/retention/defaults'

/**
 * R3.0-F · Data Retention Policies — Engine de purge.
 *
 * Itera las policies enabled de un workspace y aplica DELETE en batches
 * CTE de 1000 con cutoff `createdAt < now() - retainDays`.
 *
 * Decisiones técnicas:
 *
 *   D-R3F-1 (Batch CTE vs DELETE simple). PostgreSQL no soporta
 *           `DELETE ... LIMIT N`. Las alternativas son: (a) un DELETE
 *           sin límite (peligroso: lock prolongado en tablas grandes y
 *           transacción gigantesca), (b) CTE con SELECT ... LIMIT
 *           subquery. Elegimos (b) — el CTE acota el lock por batch,
 *           libera vacuum entre iteraciones y permite el safety cap.
 *           El precio es 1 RTT extra por batch; aceptable en cron diario.
 *
 *   D-R3F-2 (Scope por workspace). `AuditEvent`/`Session`/`Notification`
 *           NO tienen `workspaceId` directo en el schema. Filtramos por
 *           membresía (`userId` o `actorId` IN members del workspace).
 *           Eventos huérfanos (system/login fallido) NO se borran desde
 *           el cron multi-tenant — quedan a cargo de un mantenimiento
 *           global futuro. Documentado en el reporte del PR.
 *
 *   D-R3F-3 (Soft-fail por dominio). Si AUDIT_LOG falla, seguimos con
 *           SESSION etc. El RetentionPurgeRun del dominio que falló
 *           queda como FAILED con `errorMessage`. El run global del
 *           workspace agrega cada estado por separado.
 *
 *   D-R3F-4 (Update lastPurge*). `RetentionPolicy.lastPurgeAt` se setea
 *           SIEMPRE al final del ciclo del dominio (success o fail), y
 *           `lastPurgeCount` queda en 0 si hubo error. Esto permite a la
 *           UI mostrar "Último intento: ayer 03:01 · 0 filas (error)".
 */

// ───────────────────────── Tipos ─────────────────────────

export type DomainPurgeOutcome = {
  domain: RetentionDomain
  status: Exclude<RetentionPurgeStatus, 'RUNNING'>
  deletedCount: number
  errorMessage: string | null
  runId: string
}

export type WorkspacePurgeReport = {
  workspaceId: string
  startedAt: string
  completedAt: string
  outcomes: DomainPurgeOutcome[]
}

// ───────────────────────── DELETE batched por dominio ─────────────────────────

/**
 * Ejecuta el ciclo de DELETE en batches para un dominio dado, scoped al
 * workspace. Devuelve el total borrado.
 *
 * El loop termina cuando:
 *   - el batch devuelve 0 filas afectadas, O
 *   - se alcanzó `RETENTION_SAFETY_CAP` (~100k).
 *
 * El cutoff se calcula UNA SOLA VEZ al inicio (no por batch) para evitar
 * que filas creadas a mitad del ciclo se cuelen y para hacer los tests
 * deterministas.
 */
async function purgeDomain(
  policy: RetentionPolicy,
  workspaceUserIds: string[],
): Promise<number> {
  const cutoffMs = Date.now() - policy.retainDays * 24 * 60 * 60 * 1000
  const cutoff = new Date(cutoffMs)

  // El SAFETY_CAP es por dominio × workspace × ciclo. Si se llega, dejamos
  // el resto para el próximo cron (mañana). No es un error.
  let totalDeleted = 0

  while (totalDeleted < RETENTION_SAFETY_CAP) {
    const remaining = RETENTION_SAFETY_CAP - totalDeleted
    const batchLimit = Math.min(RETENTION_BATCH_SIZE, remaining)

    const deleted = await deleteBatchForDomain(
      policy.domain,
      workspaceUserIds,
      cutoff,
      batchLimit,
    )
    if (deleted === 0) break
    totalDeleted += deleted
    // Si el batch devolvió menos que el límite, ya no hay más por borrar.
    if (deleted < batchLimit) break
  }

  return totalDeleted
}

/**
 * SQL raw-templated por dominio. Cada query es un CTE:
 *
 *   WITH cte AS (
 *     SELECT id FROM "<Table>"
 *     WHERE "createdAt" < $cutoff AND <scope-filter>
 *     LIMIT $limit
 *   )
 *   DELETE FROM "<Table>" WHERE "id" IN (SELECT id FROM cte) RETURNING ...
 *
 * `executeRaw` devuelve el row count afectado (números, no rows).
 */
async function deleteBatchForDomain(
  domain: RetentionDomain,
  workspaceUserIds: string[],
  cutoff: Date,
  limit: number,
): Promise<number> {
  // Sin members en el workspace → no hay filas que tocar para los dominios
  // que dependen de userId/actorId. Salir temprano (evita un IN () inválido).
  const hasUsers = workspaceUserIds.length > 0
  if (!hasUsers && domain !== 'BRAIN_INSIGHT') {
    return 0
  }

  switch (domain) {
    case 'AUDIT_LOG': {
      // AuditEvent.createdAt < cutoff AND actorId IN (members).
      // Eventos sin actorId (system/login fallido) NO se borran desde
      // el cron de workspace (ver D-R3F-2).
      return prisma.$executeRaw(
        Prisma.sql`
          WITH cte AS (
            SELECT "id" FROM "AuditEvent"
            WHERE "createdAt" < ${cutoff}
              AND "actorId" IN (${Prisma.join(workspaceUserIds)})
            LIMIT ${limit}
          )
          DELETE FROM "AuditEvent"
          WHERE "id" IN (SELECT "id" FROM cte)
        `,
      )
    }

    case 'SESSION': {
      return prisma.$executeRaw(
        Prisma.sql`
          WITH cte AS (
            SELECT "id" FROM "Session"
            WHERE "createdAt" < ${cutoff}
              AND "userId" IN (${Prisma.join(workspaceUserIds)})
            LIMIT ${limit}
          )
          DELETE FROM "Session"
          WHERE "id" IN (SELECT "id" FROM cte)
        `,
      )
    }

    case 'NOTIFICATION': {
      return prisma.$executeRaw(
        Prisma.sql`
          WITH cte AS (
            SELECT "id" FROM "Notification"
            WHERE "createdAt" < ${cutoff}
              AND "userId" IN (${Prisma.join(workspaceUserIds)})
            LIMIT ${limit}
          )
          DELETE FROM "Notification"
          WHERE "id" IN (SELECT "id" FROM cte)
        `,
      )
    }

    case 'BRAIN_INSIGHT': {
      // BrainInsight scope vía project.workspaceId. NO incluimos
      // BrainStrategistInsight — tiene su propio workflow ACK/RESOLVED.
      // Filtramos directamente por subselect de Project del workspace.
      // workspaceUserIds aquí no se usa (project es la frontera).
      // Para reutilizar el patrón pasamos el workspaceId vía closure;
      // el caller resuelve esto invocando la versión específica.
      throw new Error(
        '[INTERNAL] BRAIN_INSIGHT debe usar deleteBatchForBrainInsight',
      )
    }
  }
}

/**
 * Variante de DELETE para BRAIN_INSIGHT que toma `workspaceId` directo.
 */
async function deleteBatchForBrainInsight(
  workspaceId: string,
  cutoff: Date,
  limit: number,
): Promise<number> {
  return prisma.$executeRaw(
    Prisma.sql`
      WITH cte AS (
        SELECT bi."id" FROM "BrainInsight" bi
        JOIN "Project" p ON bi."projectId" = p."id"
        WHERE bi."createdAt" < ${cutoff}
          AND p."workspaceId" = ${workspaceId}
        LIMIT ${limit}
      )
      DELETE FROM "BrainInsight"
      WHERE "id" IN (SELECT "id" FROM cte)
    `,
  )
}

/**
 * Wrapper que decide qué función de DELETE invocar (overloading manual
 * en lugar del switch porque BRAIN_INSIGHT no comparte el shape de los
 * otros 3 dominios).
 */
async function purgeDomainDispatch(
  policy: RetentionPolicy,
  workspaceId: string,
  workspaceUserIds: string[],
): Promise<number> {
  if (policy.domain === 'BRAIN_INSIGHT') {
    const cutoff = new Date(Date.now() - policy.retainDays * 24 * 60 * 60 * 1000)
    let total = 0
    while (total < RETENTION_SAFETY_CAP) {
      const remaining = RETENTION_SAFETY_CAP - total
      const limit = Math.min(RETENTION_BATCH_SIZE, remaining)
      const deleted = await deleteBatchForBrainInsight(workspaceId, cutoff, limit)
      if (deleted === 0) break
      total += deleted
      if (deleted < limit) break
    }
    return total
  }
  return purgeDomain(policy, workspaceUserIds)
}

// ───────────────────────── Run principal ─────────────────────────

/**
 * Itera las policies `enabled` del workspace y ejecuta el purge de cada
 * dominio en secuencia. Soft-fail: si un dominio falla, los siguientes
 * continúan.
 *
 * Para cada dominio se persiste un `RetentionPurgeRun`:
 *   - status `RUNNING` al iniciar.
 *   - status `SUCCESS` o `FAILED` al terminar (con `deletedCount` y
 *     `completedAt`).
 *
 * El `RetentionPolicy.lastPurgeAt`/`lastPurgeCount` se actualizan al
 * finalizar cada dominio.
 *
 * @returns reporte agregado con un outcome por dominio.
 */
export async function runPurgeForWorkspace(
  workspaceId: string,
): Promise<WorkspacePurgeReport> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error('[INVALID_INPUT] workspaceId requerido')
  }

  const startedAt = new Date()

  // Resolución única de members → reutilizable para los 3 dominios que
  // filtran por userId/actorId. Una sola query por ciclo.
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true },
  })
  const workspaceUserIds = members.map((m) => m.userId)

  const policies = await prisma.retentionPolicy.findMany({
    where: { workspaceId, enabled: true },
    orderBy: { domain: 'asc' },
  })

  const outcomes: DomainPurgeOutcome[] = []

  for (const policy of policies) {
    const run = await prisma.retentionPurgeRun.create({
      data: {
        policyId: policy.id,
        status: 'RUNNING',
      },
      select: { id: true },
    })

    void recordAuditEventSafe({
      action: 'retention.purge.run.started',
      entityType: 'retention_policy',
      entityId: policy.id,
      metadata: {
        workspaceId,
        domain: policy.domain,
        retainDays: policy.retainDays,
        runId: run.id,
      },
    })

    try {
      const deletedCount = await purgeDomainDispatch(
        policy,
        workspaceId,
        workspaceUserIds,
      )
      const completedAt = new Date()
      await prisma.retentionPurgeRun.update({
        where: { id: run.id },
        data: {
          deletedCount,
          status: 'SUCCESS',
          completedAt,
        },
      })
      await prisma.retentionPolicy.update({
        where: { id: policy.id },
        data: { lastPurgeAt: completedAt, lastPurgeCount: deletedCount },
      })
      outcomes.push({
        domain: policy.domain,
        status: 'SUCCESS',
        deletedCount,
        errorMessage: null,
        runId: run.id,
      })
      void recordAuditEventSafe({
        action: 'retention.purge.run.completed',
        entityType: 'retention_policy',
        entityId: policy.id,
        metadata: {
          workspaceId,
          domain: policy.domain,
          deletedCount,
          status: 'SUCCESS',
          runId: run.id,
        },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const completedAt = new Date()
      await prisma.retentionPurgeRun
        .update({
          where: { id: run.id },
          data: {
            deletedCount: 0,
            status: 'FAILED',
            completedAt,
            errorMessage,
          },
        })
        .catch(() => {
          // Si falla la persistencia del FAILED, no podemos hacer mucho
          // — el cron loguea por consola.
          console.error(
            '[Retention] persistir FAILED falló para policy',
            policy.id,
          )
        })
      await prisma.retentionPolicy
        .update({
          where: { id: policy.id },
          data: { lastPurgeAt: completedAt, lastPurgeCount: 0 },
        })
        .catch(() => undefined)
      outcomes.push({
        domain: policy.domain,
        status: 'FAILED',
        deletedCount: 0,
        errorMessage,
        runId: run.id,
      })
      void recordAuditEventSafe({
        action: 'retention.purge.run.completed',
        entityType: 'retention_policy',
        entityId: policy.id,
        metadata: {
          workspaceId,
          domain: policy.domain,
          deletedCount: 0,
          status: 'FAILED',
          errorMessage,
          runId: run.id,
        },
      })
    }
  }

  return {
    workspaceId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    outcomes,
  }
}
