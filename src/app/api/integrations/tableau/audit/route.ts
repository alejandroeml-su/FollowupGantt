/**
 * Wave R3.0 Fase 4 · Equipo P21-B · Tableau Web Data Connector.
 *
 * `GET /api/integrations/tableau/audit` — eventos de auditoría del
 * workspace de los últimos 90 días, ordenados por `createdAt` DESC.
 *
 * Limitamos a 90 días para evitar payloads gigantes (la tabla puede tener
 * millones de filas). Tableau permite refrescos manuales; quien necesite
 * histórico completo debe usar el endpoint OData con paginación profunda.
 *
 * `AuditEvent` no tiene FK a workspace directa — filtramos cruzando
 * `actor.workspaceId` cuando hay actor, y dejamos pasar eventos system
 * (actorId NULL) porque pertenecen al tenant que generó la API key.
 *
 * Query params:
 *   - `action`     filtra por verbo exacto (ej. `task.created`).
 *   - `entityType` filtra por tipo de entidad.
 *   - `cursor`     paginación por id asc.
 *   - `limit`      1..5000 (default 5000).
 *
 * Auth: Bearer API key v2 con scope `read:exports`.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { errorResponseFromException } from '@/lib/api/v2-response'
import { requireApiKey } from '@/app/api/v2/_helpers'
import {
  isoOrNull,
  parseTableauPagination,
  tableauJsonResponse,
} from '@/lib/integrations/tableau-schema'
import { recordAuditEventSafe } from '@/lib/audit/events'

export const dynamic = 'force-dynamic'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  try {
    const gate = await requireApiKey(request, 'read:exports')
    if (!gate.ok) return gate.response
    const { workspaceId } = gate.auth.apiKey

    const url = new URL(request.url)
    const { cursor, limit } = parseTableauPagination(url)
    const action = url.searchParams.get('action')
    const entityType = url.searchParams.get('entityType')

    const since = new Date(Date.now() - NINETY_DAYS_MS)

    // Filtramos por workspace via `actor.workspaceId`. Aceptamos también
    // eventos con actor null (system events) para no perderlos del feed.
    const where: Record<string, unknown> = {
      createdAt: { gte: since },
      OR: [{ actor: { workspaceId } }, { actorId: null }],
    }
    if (action) where.action = action
    if (entityType) where.entityType = entityType

    const rows = await prisma.auditEvent.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        actorId: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
      },
    })

    let nextCursor: string | null = null
    if (rows.length > limit) {
      const last = rows.pop()
      nextCursor = last?.id ?? null
    }

    const mapped = rows.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? '',
      actorId: e.actorId ?? '',
      actorName: e.actor
        ? `${e.actor.name}${e.actor.email ? ` <${e.actor.email}>` : ''}`
        : '',
      ipAddress: e.ipAddress ?? '',
      createdAt: isoOrNull(e.createdAt),
    }))

    void recordAuditEventSafe({
      action: 'tableau.dataset_fetched',
      entityType: 'export',
      metadata: {
        dataset: 'audit',
        rowCount: mapped.length,
        hasNextPage: nextCursor !== null,
      },
    })

    return tableauJsonResponse({ table: 'audit', rows: mapped, nextCursor })
  } catch (err) {
    return errorResponseFromException(err)
  }
}
