'use server'

/**
 * Ola P3 · Equipo P3-2 · Server actions del Audit Log centralizado.
 *
 * Operaciones expuestas:
 *   - `createAuditEvent` (proxy server-action al helper `recordAuditEvent`
 *     para callers que prefieran action-binding sobre import directo).
 *   - `queryAuditEvents` para la página `/audit-log` (paginación cursor + filtros).
 *   - `purgeOldAuditEvents` para retention policy (>90 días por default).
 *
 * Convenciones del repo:
 *   - Errores tipados con prefijo `[CODE] detalle`.
 *   - `unstable_cache` con tag `audit-events` para el listado; cualquier
 *     create/purge invalida con `revalidateTag(... 'max')`.
 *   - Sin auth real aún: el guard de roles es responsabilidad del caller
 *     (la página `/audit-log` valida con el debug-role del Sidebar; cuando
 *     llegue Auth real se moverá aquí).
 */

import { z } from 'zod'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEvent } from '@/lib/audit/events'
import {
  DEFAULT_RETENTION_DAYS,
  KNOWN_AUDIT_ACTIONS,
  type AuditErrorCode,
  type RecordAuditEventInput,
  type SerializedAuditEvent,
} from '@/lib/audit/types'

// ───────────────────────── Errores tipados ─────────────────────────

function actionError(code: AuditErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas / Tipos ─────────────────────────

const queryFiltersSchema = z.object({
  actorId: z.string().min(1).nullish(),
  entityType: z.string().min(1).max(100).nullish(),
  entityId: z.string().min(1).max(200).nullish(),
  action: z.enum(KNOWN_AUDIT_ACTIONS).nullish(),
  // ISO date strings; ambos opcionales. Si solo viene `from`, queda
  // abierto en el extremo derecho (y viceversa).
  from: z.string().datetime().nullish(),
  to: z.string().datetime().nullish(),
  limit: z.number().int().min(1).max(200).default(50),
  // Cursor = `id` del último evento del page anterior (combinado con
  // `createdAt` para evitar ties). Mantenemos string simple.
  cursorId: z.string().min(1).nullish(),
})

export type QueryAuditEventsInput = z.input<typeof queryFiltersSchema>

const purgeSchema = z.object({
  // Permite override de retention (ej. 30 días para test). Default 90.
  retentionDays: z.number().int().min(1).max(3650).default(DEFAULT_RETENTION_DAYS),
  // Dry-run para que la UI muestre cuántos se borrarían antes de confirmar.
  dryRun: z.boolean().default(false),
})

export type PurgeAuditEventsInput = z.input<typeof purgeSchema>

// ───────────────────────── Serialización ─────────────────────────

type AuditRow = {
  id: string
  actorId: string | null
  action: string
  entityType: string
  entityId: string | null
  before: Prisma.JsonValue | null
  after: Prisma.JsonValue | null
  ipAddress: string | null
  userAgent: string | null
  metadata: Prisma.JsonValue | null
  createdAt: Date
  actor: { id: string; name: string; email: string } | null
}

function serialize(row: AuditRow): SerializedAuditEvent {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    actorEmail: row.actor?.email ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before ?? null,
    after: row.after ?? null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

// ───────────────────────── Cache helpers ─────────────────────────

/**
 * Cache key incluye todos los filtros serializados. Tag `audit-events`
 * permite invalidar de golpe tras create/purge sin tocar todas las keys.
 */
function getEventsCached(filters: z.output<typeof queryFiltersSchema>) {
  const cacheKey = [
    'audit-events',
    filters.actorId ?? '',
    filters.entityType ?? '',
    filters.entityId ?? '',
    filters.action ?? '',
    filters.from ?? '',
    filters.to ?? '',
    String(filters.limit),
    filters.cursorId ?? '',
  ]

  return unstable_cache(
    async () => {
      const where: Prisma.AuditEventWhereInput = {}
      if (filters.actorId) where.actorId = filters.actorId
      if (filters.entityType) where.entityType = filters.entityType
      if (filters.entityId) where.entityId = filters.entityId
      if (filters.action) where.action = filters.action
      if (filters.from || filters.to) {
        where.createdAt = {}
        if (filters.from) where.createdAt.gte = new Date(filters.from)
        if (filters.to) where.createdAt.lte = new Date(filters.to)
      }

      // Cursor: pedimos `limit + 1` para saber si hay siguiente página
      // sin un count(*) extra. El cursor compone (createdAt desc, id desc).
      const rows = await prisma.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filters.limit + 1,
        ...(filters.cursorId
          ? { cursor: { id: filters.cursorId }, skip: 1 }
          : {}),
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
      })

      const hasMore = rows.length > filters.limit
      const slice = hasMore ? rows.slice(0, filters.limit) : rows
      return {
        items: slice.map(serialize),
        nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
      }
    },
    cacheKey,
    { tags: ['audit-events'] },
  )()
}

async function invalidateAuditCache(): Promise<void> {
  // Perfil 'max' = stale-while-revalidate consistente con el resto del repo.
  revalidateTag('audit-events', 'max')
}

// ───────────────────────── Server actions: create ─────────────────────────

/**
 * Proxy server-action al helper `recordAuditEvent`. Útil cuando la action
 * que dispara el evento vive en otra pieza del repo y no quiere importar
 * el módulo `lib/audit/events.ts` (mantiene la frontera "todo es server
 * action" en archivos `actions/*`).
 */
export async function createAuditEvent(
  input: RecordAuditEventInput,
): Promise<{ id: string; createdAt: string }> {
  const result = await recordAuditEvent(input)
  await invalidateAuditCache()
  // No revalida `/audit-log` aquí: la página usa el cache tag y se
  // refresca al siguiente request. Si lo necesitas inmediato, llama a
  // `revalidatePath('/audit-log')` desde el caller.
  return result
}

// ───────────────────────── Server actions: read ─────────────────────────

/**
 * Lee eventos paginados con filtros. Devuelve `items` + `nextCursor` (null
 * si no hay más páginas). El consumidor mantiene los cursors en estado
 * cliente para "cargar más".
 *
 * @throws `[INVALID_INPUT]` si los filtros son inválidos.
 */
export async function queryAuditEvents(
  input: QueryAuditEventsInput = {},
): Promise<{ items: SerializedAuditEvent[]; nextCursor: string | null }> {
  const parsed = queryFiltersSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  return getEventsCached(parsed.data)
}

// ───────────────────────── Server actions: purge ─────────────────────────

/**
 * Elimina eventos con `createdAt < now() - retentionDays`. Operación
 * destructiva: la UI debe pedir confirmación antes de invocar (el
 * componente `AuditFilters` muestra un diálogo).
 *
 * Modos:
 *   - `dryRun: true` → solo cuenta cuántos se borrarían (no muta).
 *   - `dryRun: false` (default) → ejecuta `deleteMany` y devuelve el count.
 *
 * Compliance: la action no audita su propia ejecución (eso sería un
 * `audit.purged`); el evento se registra en logs aplicativos vía consola.
 * Si se requiere para SOC2, añadir un evento `audit.purged` con
 * `entityType: 'audit'` y `metadata: { count, retentionDays }`.
 */
export async function purgeOldAuditEvents(
  input: PurgeAuditEventsInput = {},
): Promise<{ count: number; cutoffIso: string; dryRun: boolean }> {
  const parsed = purgeSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { retentionDays, dryRun } = parsed.data

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)

  if (dryRun) {
    const count = await prisma.auditEvent.count({
      where: { createdAt: { lt: cutoff } },
    })
    return { count, cutoffIso: cutoff.toISOString(), dryRun: true }
  }

  const result = await prisma.auditEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  await invalidateAuditCache()
  revalidatePath('/audit-log')
  return {
    count: result.count,
    cutoffIso: cutoff.toISOString(),
    dryRun: false,
  }
}

// ───────────────────────── Helpers para la UI ─────────────────────────

/**
 * Lista de actores distintos presentes en el log (para el dropdown de
 * filtro). Cap a 200 para no reventar el `<select>` si el log crece.
 * Cacheado bajo el mismo tag `audit-events` para invalidación coherente.
 */
export async function getAuditActors(): Promise<
  { id: string; name: string; email: string }[]
> {
  return unstable_cache(
    async () => {
      const rows = await prisma.auditEvent.findMany({
        where: { actorId: { not: null } },
        distinct: ['actorId'],
        take: 200,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, name: true, email: true } } },
      })
      return rows
        .map((r) => r.actor)
        .filter((a): a is { id: string; name: string; email: string } => !!a)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    },
    ['audit-actors'],
    { tags: ['audit-events'] },
  )()
}

/**
 * Lista de entityTypes distintos en el log (para el dropdown de filtro).
 * Cap a 50 — más de 50 tipos de entidad sería un anti-patrón del catálogo.
 */
export async function getAuditEntityTypes(): Promise<string[]> {
  return unstable_cache(
    async () => {
      const rows = await prisma.auditEvent.findMany({
        distinct: ['entityType'],
        take: 50,
        select: { entityType: true },
      })
      return rows.map((r) => r.entityType).sort((a, b) => a.localeCompare(b, 'es'))
    },
    ['audit-entity-types'],
    { tags: ['audit-events'] },
  )()
}
