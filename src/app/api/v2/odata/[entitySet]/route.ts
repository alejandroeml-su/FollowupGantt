/**
 * Wave R3.0 Fase 4.2 · BI Export Connector — OData v4 entity set dispatch.
 *
 * Único route handler para los 6 entity sets + `$metadata`. Usamos un
 * dynamic segment en lugar de directorios separados para evitar `$` en
 * paths (incompatible con algunos filesystems / herramientas) y para
 * compartir la pipeline auth/parse/serialize.
 *
 * Rutas:
 *   - GET /api/v2/odata/$metadata         → EDMX XML (delegado a route dedicado).
 *   - GET /api/v2/odata/Projects          → JSON value=[Project...].
 *   - GET /api/v2/odata/Tasks             → JSON value=[Task...].
 *   - GET /api/v2/odata/Sprints           → JSON value=[Sprint...].
 *   - GET /api/v2/odata/Risks             → JSON value=[Risk...] (score+severity calc).
 *   - GET /api/v2/odata/EVMSnapshots      → JSON value=[EVMSnapshot...].
 *   - GET /api/v2/odata/AuditEvents       → JSON value=[AuditEvent...].
 *
 * Soporta `$top`, `$skip`, `$filter` (eq/ne/gt/ge/lt/le + and), `$select`,
 * `$orderby`, `$count`, `$expand` (whitelisted nav props).
 *
 * Backward-compat: queries existentes del PR #192 (sin $select/$orderby/
 * $count/$expand) siguen funcionando idénticamente.
 *
 * Scope auth: `read:exports`.
 *
 * Audit: emite `powerbi.dataset_fetched` por cada request exitosa (best
 * effort — fallo en audit no rompe la response).
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import {
  odataAuth,
  odataError,
  odataOk,
  parseTopSkip,
  filterToPrismaWhere,
  odataSerialize,
  parseSelect,
  selectToPrisma,
  parseOrderby,
  orderbyToPrisma,
  parseCount,
  parseExpand,
  expandToPrismaInclude,
  type FilterFieldMap,
  type ExpandWhitelist,
} from '@/lib/api/odata'
import { tierFromScore } from '@/lib/risks/risk-score'
import { metadataResponse } from '../metadata'
import { recordAuditEvent } from '@/lib/audit/events'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────
// Selectable / orderable / expandable whitelists por entity.
//
// Mantenemos columnas alineadas con el schema EDMX expuesto en
// $metadata. Cualquier campo no listado aquí se rechaza en $select/
// $orderby con `[INVALID_INPUT]`.
// ─────────────────────────────────────────────────────────────────

const PROJECT_COLUMNS = [
  'id',
  'name',
  'status',
  'methodology',
  'cpi',
  'spi',
  'budget',
  'budgetCurrency',
  'managerId',
  'areaId',
  'workspaceId',
  'createdAt',
  'updatedAt',
] as const

const TASK_COLUMNS = [
  'id',
  'mnemonic',
  'title',
  'status',
  'priority',
  'storyPoints',
  'plannedValue',
  'actualCost',
  'earnedValue',
  'progress',
  'projectId',
  'sprintId',
  'epicId',
  'assigneeId',
  'startDate',
  'endDate',
  'createdAt',
  'updatedAt',
] as const

const SPRINT_COLUMNS = [
  'id',
  'name',
  'goal',
  'status',
  'startDate',
  'endDate',
  'capacity',
  'velocityActual',
  'projectId',
  'createdAt',
  'updatedAt',
] as const

const RISK_COLUMNS = [
  'id',
  'projectId',
  'title',
  'probability',
  'impact',
  'score',
  'severity',
  'status',
  'ownerId',
  'source',
  'detectedAt',
  'closedAt',
  'createdAt',
  'updatedAt',
] as const

const EVM_COLUMNS = [
  'id',
  'projectId',
  'snapshotDate',
  'plannedValue',
  'earnedValue',
  'actualCost',
  'budgetAtCompletion',
  'cpi',
  'spi',
  'estimateAtCompletion',
  'varianceAtCompletion',
  'createdAt',
] as const

const AUDIT_COLUMNS = [
  'id',
  'actorId',
  'action',
  'entityType',
  'entityId',
  'ipAddress',
  'userAgent',
  'createdAt',
] as const

// ─────────────────────────────────────────────────────────────────
// $expand whitelist por entity (1 nivel solamente).
// Power BI rara vez necesita más de 1 nivel — keep simple para perf.
// ─────────────────────────────────────────────────────────────────

const PROJECT_EXPANDS: ExpandWhitelist = {
  Tasks: { prismaInclude: 'tasks' },
}

const SPRINT_EXPANDS: ExpandWhitelist = {
  Project: { prismaInclude: 'project' },
}

// ─────────────────────────────────────────────────────────────────
// Filter field maps por entity (whitelist) — sin cambios vs #192.
// Risk: score y severity NO se filtran directo (son derivados).
// ─────────────────────────────────────────────────────────────────

const PROJECT_FIELDS: FilterFieldMap = {
  id: { type: 'string' },
  name: { type: 'string' },
  status: { type: 'string' },
  methodology: { type: 'string' },
  cpi: { type: 'float' },
  spi: { type: 'float' },
  managerId: { type: 'string' },
  areaId: { type: 'string' },
  createdAt: { type: 'datetime' },
  updatedAt: { type: 'datetime' },
}

const TASK_FIELDS: FilterFieldMap = {
  id: { type: 'string' },
  mnemonic: { type: 'string' },
  title: { type: 'string' },
  status: { type: 'string' },
  priority: { type: 'string' },
  storyPoints: { type: 'int' },
  progress: { type: 'int' },
  projectId: { type: 'string' },
  sprintId: { type: 'string' },
  epicId: { type: 'string' },
  assigneeId: { type: 'string' },
  startDate: { type: 'datetime' },
  endDate: { type: 'datetime' },
  createdAt: { type: 'datetime' },
  updatedAt: { type: 'datetime' },
}

const SPRINT_FIELDS: FilterFieldMap = {
  id: { type: 'string' },
  name: { type: 'string' },
  status: { type: 'string' },
  projectId: { type: 'string' },
  startDate: { type: 'datetime' },
  endDate: { type: 'datetime' },
  capacity: { type: 'int' },
  velocityActual: { type: 'int' },
  createdAt: { type: 'datetime' },
  updatedAt: { type: 'datetime' },
}

const RISK_FIELDS: FilterFieldMap = {
  id: { type: 'string' },
  projectId: { type: 'string' },
  title: { type: 'string' },
  probability: { type: 'int' },
  impact: { type: 'int' },
  status: { type: 'string' },
  ownerId: { type: 'string' },
  source: { type: 'string' },
  detectedAt: { type: 'datetime' },
  closedAt: { type: 'datetime' },
  createdAt: { type: 'datetime' },
}

const EVM_FIELDS: FilterFieldMap = {
  id: { type: 'string' },
  projectId: { type: 'string' },
  snapshotDate: { type: 'datetime' },
  cpi: { type: 'float' },
  spi: { type: 'float' },
  createdAt: { type: 'datetime' },
}

const AUDIT_FIELDS: FilterFieldMap = {
  id: { type: 'string' },
  actorId: { type: 'string' },
  action: { type: 'string' },
  entityType: { type: 'string' },
  entityId: { type: 'string' },
  createdAt: { type: 'datetime' },
}

// ─────────────────────────────────────────────────────────────────
// Handler único
// ─────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entitySet: string }> },
): Promise<Response> {
  const { entitySet: rawEntity } = await params
  const entitySet = decodeURIComponent(rawEntity)

  // $metadata es público — delegado al route dedicado.
  if (entitySet === '$metadata') {
    return metadataResponse()
  }

  const gate = await odataAuth(request, 'read:exports')
  if (!gate.ok) return gate.response

  const url = new URL(request.url)
  const { top, skip } = parseTopSkip(url)
  const filterRaw = url.searchParams.get('$filter')
  const selectRaw = url.searchParams.get('$select')
  const orderbyRaw = url.searchParams.get('$orderby')
  const countRaw = url.searchParams.get('$count')
  const expandRaw = url.searchParams.get('$expand')

  try {
    let response: Response
    switch (entitySet) {
      case 'Projects':
        response = await handleProjects(request, gate.workspaceId, {
          filterRaw,
          selectRaw,
          orderbyRaw,
          countRaw,
          expandRaw,
          top,
          skip,
        })
        break
      case 'Tasks':
        response = await handleTasks(request, gate.workspaceId, {
          filterRaw,
          selectRaw,
          orderbyRaw,
          countRaw,
          top,
          skip,
        })
        break
      case 'Sprints':
        response = await handleSprints(request, gate.workspaceId, {
          filterRaw,
          selectRaw,
          orderbyRaw,
          countRaw,
          expandRaw,
          top,
          skip,
        })
        break
      case 'Risks':
        response = await handleRisks(request, gate.workspaceId, {
          filterRaw,
          selectRaw,
          orderbyRaw,
          countRaw,
          top,
          skip,
        })
        break
      case 'EVMSnapshots':
        response = await handleEVM(request, gate.workspaceId, {
          filterRaw,
          selectRaw,
          orderbyRaw,
          countRaw,
          top,
          skip,
        })
        break
      case 'AuditEvents':
        response = await handleAuditEvents(request, gate.workspaceId, {
          filterRaw,
          selectRaw,
          orderbyRaw,
          countRaw,
          top,
          skip,
        })
        break
      default:
        return odataError(
          'NOT_FOUND',
          `Entity set no encontrado: ${entitySet}. Disponibles: Projects, Tasks, Sprints, Risks, EVMSnapshots, AuditEvents`,
          404,
        )
    }

    // Audit event — best effort. Detectamos Power BI por User-Agent
    // pero el evento se emite para todos los clientes BI por uniformidad.
    void emitDatasetFetchedAudit(request, entitySet, gate.workspaceId).catch(
      () => undefined,
    )

    return response
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return odataError('INTERNAL_ERROR', msg, 500)
  }
}

// ─────────────────────────────────────────────────────────────────
// Handler factory — shared logic for entities sin enriquecimiento.
// ─────────────────────────────────────────────────────────────────

interface QueryOpts {
  filterRaw: string | null
  selectRaw: string | null
  orderbyRaw: string | null
  countRaw: string | null
  expandRaw?: string | null
  top: number
  skip: number
}

async function handleProjects(
  request: NextRequest,
  workspaceId: string,
  q: QueryOpts,
): Promise<Response> {
  const parsedFilter = filterToPrismaWhere(q.filterRaw, PROJECT_FIELDS)
  if (!parsedFilter.ok) return odataError('INVALID_INPUT', parsedFilter.message)

  const parsedSelect = parseSelect(q.selectRaw, PROJECT_COLUMNS)
  if (!parsedSelect.ok) return odataError('INVALID_INPUT', parsedSelect.message)

  const parsedOrderby = parseOrderby(q.orderbyRaw, PROJECT_COLUMNS)
  if (!parsedOrderby.ok) return odataError('INVALID_INPUT', parsedOrderby.message)

  const parsedCount = parseCount(q.countRaw)
  if (!parsedCount.ok) return odataError('INVALID_INPUT', parsedCount.message)

  const parsedExpand = parseExpand(q.expandRaw ?? null, PROJECT_EXPANDS)
  if (!parsedExpand.ok) return odataError('INVALID_INPUT', parsedExpand.message)

  const where = { workspaceId, ...parsedFilter.where }
  const selectFields = parsedSelect.fields
  const include = expandToPrismaInclude(parsedExpand.navs, PROJECT_EXPANDS)

  // Prisma: si select está presente, no permite include simultáneo.
  // Para combinar $select + $expand, promovemos el select a un select
  // de propiedades + navProps. Si solo hay $expand, usamos include.
  const findArgs: Record<string, unknown> = {
    where,
    orderBy: orderbyToPrisma(parsedOrderby.clauses),
    take: q.top,
    skip: q.skip,
  }

  if (selectFields) {
    const selectObj: Record<string, unknown> = selectToPrisma(selectFields) ?? {}
    if (include) Object.assign(selectObj, include)
    findArgs.select = selectObj
  } else {
    findArgs.select = {
      id: true,
      name: true,
      status: true,
      methodology: true,
      cpi: true,
      spi: true,
      budget: true,
      budgetCurrency: true,
      managerId: true,
      areaId: true,
      workspaceId: true,
      createdAt: true,
      updatedAt: true,
      ...(include ?? {}),
    }
  }

  const [rows, total] = await Promise.all([
    prisma.project.findMany(findArgs as Parameters<typeof prisma.project.findMany>[0]),
    parsedCount.include ? prisma.project.count({ where }) : Promise.resolve(undefined),
  ])
  return odataOk(request, 'Projects', rows.map(odataSerialize as never), {
    count: total,
    selectFields,
  })
}

async function handleTasks(
  request: NextRequest,
  workspaceId: string,
  q: QueryOpts,
): Promise<Response> {
  const parsedFilter = filterToPrismaWhere(q.filterRaw, TASK_FIELDS)
  if (!parsedFilter.ok) return odataError('INVALID_INPUT', parsedFilter.message)

  const parsedSelect = parseSelect(q.selectRaw, TASK_COLUMNS)
  if (!parsedSelect.ok) return odataError('INVALID_INPUT', parsedSelect.message)

  const parsedOrderby = parseOrderby(q.orderbyRaw, TASK_COLUMNS)
  if (!parsedOrderby.ok) return odataError('INVALID_INPUT', parsedOrderby.message)

  const parsedCount = parseCount(q.countRaw)
  if (!parsedCount.ok) return odataError('INVALID_INPUT', parsedCount.message)

  const where = { project: { workspaceId }, ...parsedFilter.where }
  const selectFields = parsedSelect.fields

  const findArgs: Record<string, unknown> = {
    where,
    orderBy: orderbyToPrisma(parsedOrderby.clauses),
    take: q.top,
    skip: q.skip,
  }

  if (selectFields) {
    findArgs.select = selectToPrisma(selectFields)
  } else {
    findArgs.select = {
      id: true,
      mnemonic: true,
      title: true,
      status: true,
      priority: true,
      storyPoints: true,
      plannedValue: true,
      actualCost: true,
      earnedValue: true,
      progress: true,
      projectId: true,
      sprintId: true,
      epicId: true,
      assigneeId: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      updatedAt: true,
    }
  }

  const [rows, total] = await Promise.all([
    prisma.task.findMany(findArgs as Parameters<typeof prisma.task.findMany>[0]),
    parsedCount.include ? prisma.task.count({ where }) : Promise.resolve(undefined),
  ])
  return odataOk(request, 'Tasks', rows.map(odataSerialize as never), {
    count: total,
    selectFields,
  })
}

async function handleSprints(
  request: NextRequest,
  workspaceId: string,
  q: QueryOpts,
): Promise<Response> {
  const parsedFilter = filterToPrismaWhere(q.filterRaw, SPRINT_FIELDS)
  if (!parsedFilter.ok) return odataError('INVALID_INPUT', parsedFilter.message)

  const parsedSelect = parseSelect(q.selectRaw, SPRINT_COLUMNS)
  if (!parsedSelect.ok) return odataError('INVALID_INPUT', parsedSelect.message)

  const parsedOrderby = parseOrderby(q.orderbyRaw, SPRINT_COLUMNS)
  if (!parsedOrderby.ok) return odataError('INVALID_INPUT', parsedOrderby.message)

  const parsedCount = parseCount(q.countRaw)
  if (!parsedCount.ok) return odataError('INVALID_INPUT', parsedCount.message)

  const parsedExpand = parseExpand(q.expandRaw ?? null, SPRINT_EXPANDS)
  if (!parsedExpand.ok) return odataError('INVALID_INPUT', parsedExpand.message)

  const where = { project: { workspaceId }, ...parsedFilter.where }
  const selectFields = parsedSelect.fields
  const include = expandToPrismaInclude(parsedExpand.navs, SPRINT_EXPANDS)

  const findArgs: Record<string, unknown> = {
    where,
    orderBy: orderbyToPrisma(parsedOrderby.clauses),
    take: q.top,
    skip: q.skip,
  }

  if (selectFields) {
    const selectObj: Record<string, unknown> = selectToPrisma(selectFields) ?? {}
    if (include) Object.assign(selectObj, include)
    findArgs.select = selectObj
  } else {
    findArgs.select = {
      id: true,
      name: true,
      goal: true,
      status: true,
      startDate: true,
      endDate: true,
      capacity: true,
      velocityActual: true,
      projectId: true,
      createdAt: true,
      updatedAt: true,
      ...(include ?? {}),
    }
  }

  const [rows, total] = await Promise.all([
    prisma.sprint.findMany(findArgs as Parameters<typeof prisma.sprint.findMany>[0]),
    parsedCount.include ? prisma.sprint.count({ where }) : Promise.resolve(undefined),
  ])
  return odataOk(request, 'Sprints', rows.map(odataSerialize as never), {
    count: total,
    selectFields,
  })
}

async function handleRisks(
  request: NextRequest,
  workspaceId: string,
  q: QueryOpts,
): Promise<Response> {
  const parsedFilter = filterToPrismaWhere(q.filterRaw, RISK_FIELDS)
  if (!parsedFilter.ok) return odataError('INVALID_INPUT', parsedFilter.message)

  const parsedSelect = parseSelect(q.selectRaw, RISK_COLUMNS)
  if (!parsedSelect.ok) return odataError('INVALID_INPUT', parsedSelect.message)

  // $orderby por score/severity NO se delega a Prisma (son derivados);
  // se ordena en memoria post-fetch.
  const parsedOrderby = parseOrderby(q.orderbyRaw, RISK_COLUMNS)
  if (!parsedOrderby.ok) return odataError('INVALID_INPUT', parsedOrderby.message)

  const parsedCount = parseCount(q.countRaw)
  if (!parsedCount.ok) return odataError('INVALID_INPUT', parsedCount.message)

  const where = { project: { workspaceId }, ...parsedFilter.where }
  const selectFields = parsedSelect.fields

  // Para Risks SIEMPRE fetcheamos los campos base (incluyendo
  // probability + impact) porque score/severity son derivados de ellos.
  // El $select se aplica DESPUÉS de calcular en `applySelectInMemory`.
  const orderbyHasDerived =
    parsedOrderby.clauses?.some((c) => c.field === 'score' || c.field === 'severity') ??
    false

  const orderBy = orderbyHasDerived
    ? { id: 'asc' as const } // server-side fallback; reorder in memory después
    : orderbyToPrisma(parsedOrderby.clauses)

  const rows = await prisma.risk.findMany({
    where,
    orderBy,
    take: orderbyHasDerived ? undefined : q.top,
    skip: orderbyHasDerived ? undefined : q.skip,
    select: {
      id: true,
      projectId: true,
      title: true,
      probability: true,
      impact: true,
      status: true,
      ownerId: true,
      source: true,
      detectedAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  let enriched = rows.map((r) => {
    const score = r.probability * r.impact
    return { ...r, score, severity: tierFromScore(score) }
  })

  if (orderbyHasDerived && parsedOrderby.clauses) {
    enriched = [...enriched].sort((a, b) => {
      for (const c of parsedOrderby.clauses!) {
        const av = (a as Record<string, unknown>)[c.field]
        const bv = (b as Record<string, unknown>)[c.field]
        if (av === bv) continue
        if (av === null || av === undefined) return 1
        if (bv === null || bv === undefined) return -1
        const cmp = (av as number | string) < (bv as number | string) ? -1 : 1
        return c.dir === 'asc' ? cmp : -cmp
      }
      return 0
    })
    enriched = enriched.slice(q.skip, q.skip + q.top)
  }

  // Aplicar $select post-enriquecimiento.
  const projected = applySelectInMemory(enriched, selectFields)

  const total = parsedCount.include ? await prisma.risk.count({ where }) : undefined
  return odataOk(request, 'Risks', projected.map(odataSerialize as never), {
    count: total,
    selectFields,
  })
}

async function handleEVM(
  request: NextRequest,
  workspaceId: string,
  q: QueryOpts,
): Promise<Response> {
  const parsedFilter = filterToPrismaWhere(q.filterRaw, EVM_FIELDS)
  if (!parsedFilter.ok) return odataError('INVALID_INPUT', parsedFilter.message)

  const parsedSelect = parseSelect(q.selectRaw, EVM_COLUMNS)
  if (!parsedSelect.ok) return odataError('INVALID_INPUT', parsedSelect.message)

  const parsedOrderby = parseOrderby(q.orderbyRaw, EVM_COLUMNS)
  if (!parsedOrderby.ok) return odataError('INVALID_INPUT', parsedOrderby.message)

  const parsedCount = parseCount(q.countRaw)
  if (!parsedCount.ok) return odataError('INVALID_INPUT', parsedCount.message)

  const where = { project: { workspaceId }, ...parsedFilter.where }
  const selectFields = parsedSelect.fields

  const findArgs: Record<string, unknown> = {
    where,
    orderBy: orderbyToPrisma(parsedOrderby.clauses),
    take: q.top,
    skip: q.skip,
  }

  if (selectFields) {
    findArgs.select = selectToPrisma(selectFields)
  } else {
    findArgs.select = {
      id: true,
      projectId: true,
      snapshotDate: true,
      plannedValue: true,
      earnedValue: true,
      actualCost: true,
      budgetAtCompletion: true,
      cpi: true,
      spi: true,
      estimateAtCompletion: true,
      varianceAtCompletion: true,
      createdAt: true,
    }
  }

  const [rows, total] = await Promise.all([
    prisma.eVMSnapshot.findMany(
      findArgs as Parameters<typeof prisma.eVMSnapshot.findMany>[0],
    ),
    parsedCount.include
      ? prisma.eVMSnapshot.count({ where })
      : Promise.resolve(undefined),
  ])
  return odataOk(request, 'EVMSnapshots', rows.map(odataSerialize as never), {
    count: total,
    selectFields,
  })
}

async function handleAuditEvents(
  request: NextRequest,
  workspaceId: string,
  q: QueryOpts,
): Promise<Response> {
  const parsedFilter = filterToPrismaWhere(q.filterRaw, AUDIT_FIELDS)
  if (!parsedFilter.ok) return odataError('INVALID_INPUT', parsedFilter.message)

  const parsedSelect = parseSelect(q.selectRaw, AUDIT_COLUMNS)
  if (!parsedSelect.ok) return odataError('INVALID_INPUT', parsedSelect.message)

  const parsedOrderby = parseOrderby(q.orderbyRaw, AUDIT_COLUMNS)
  if (!parsedOrderby.ok) return odataError('INVALID_INPUT', parsedOrderby.message)

  const parsedCount = parseCount(q.countRaw)
  if (!parsedCount.ok) return odataError('INVALID_INPUT', parsedCount.message)

  // AuditEvent no tiene workspaceId directo; lo filtramos a través
  // del actor. Si actor es null (system events) los excluimos para
  // evitar leaks cross-workspace.
  const where = {
    actor: { workspaceMemberships: { some: { workspaceId } } },
    ...parsedFilter.where,
  }
  const selectFields = parsedSelect.fields

  const findArgs: Record<string, unknown> = {
    where,
    orderBy:
      parsedOrderby.clauses && parsedOrderby.clauses.length > 0
        ? orderbyToPrisma(parsedOrderby.clauses)
        : { createdAt: 'desc' },
    take: q.top,
    skip: q.skip,
  }

  if (selectFields) {
    findArgs.select = selectToPrisma(selectFields)
  } else {
    findArgs.select = {
      id: true,
      actorId: true,
      action: true,
      entityType: true,
      entityId: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
    }
  }

  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany(
      findArgs as Parameters<typeof prisma.auditEvent.findMany>[0],
    ),
    parsedCount.include
      ? prisma.auditEvent.count({ where })
      : Promise.resolve(undefined),
  ])
  return odataOk(request, 'AuditEvents', rows.map(odataSerialize as never), {
    count: total,
    selectFields,
  })
}

// ─────────────────────────────────────────────────────────────────
// Utility: aplica $select sobre objetos ya enriquecidos en memoria.
// Necesario para Risks donde `score`/`severity` se calculan post-fetch.
// ─────────────────────────────────────────────────────────────────

function applySelectInMemory<T extends Record<string, unknown>>(
  rows: T[],
  selectFields: readonly string[] | null,
): Record<string, unknown>[] {
  if (!selectFields || selectFields.length === 0) {
    return rows as unknown as Record<string, unknown>[]
  }
  return rows.map((r) => {
    const out: Record<string, unknown> = {}
    // Forzar `id` siempre para mantener contrato OData.
    if ('id' in r) out.id = r.id
    for (const f of selectFields) {
      if (f in r) out[f] = (r as Record<string, unknown>)[f]
    }
    return out
  })
}

// ─────────────────────────────────────────────────────────────────
// Audit: emite `powerbi.dataset_fetched` best-effort.
// ─────────────────────────────────────────────────────────────────

async function emitDatasetFetchedAudit(
  request: NextRequest,
  entitySet: string,
  workspaceId: string,
): Promise<void> {
  const ua = request.headers.get('user-agent') ?? null
  const isPowerBI = ua ? /Power\s?BI|Microsoft\.Data\.Mashup|Power Query/i.test(ua) : false
  await recordAuditEvent({
    action: 'powerbi.dataset_fetched',
    entityType: 'odata_entity_set',
    entityId: entitySet,
    metadata: {
      workspaceId,
      userAgent: ua,
      isPowerBIClient: isPowerBI,
      query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    },
  })
}
