/**
 * Wave R3.0 Fase 4.2 · BI Export Connector — OData v4 entity set dispatch.
 *
 * Único route handler para los 4 entity sets + `$metadata`. Usamos un
 * dynamic segment en lugar de directorios separados para evitar `$` en
 * paths (incompatible con algunos filesystems / herramientas) y para
 * compartir la pipeline auth/parse/serialize.
 *
 * Rutas:
 *   - GET /api/v2/odata/$metadata         → EDMX XML.
 *   - GET /api/v2/odata/Projects          → JSON value=[Project...].
 *   - GET /api/v2/odata/Tasks             → JSON value=[Task...].
 *   - GET /api/v2/odata/Risks             → JSON value=[Risk...] (score+severity calc).
 *   - GET /api/v2/odata/EVMSnapshots      → JSON value=[EVMSnapshot...].
 *
 * Soporta `$top`, `$skip`, `$filter` (eq/ne/gt/ge/lt/le + and).
 *
 * Scope auth: `read:exports`.
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
  type FilterFieldMap,
} from '@/lib/api/odata'
import { tierFromScore } from '@/lib/risks/risk-score'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────
// EDMX $metadata XML
// ─────────────────────────────────────────────────────────────────

const EDMX_DOC = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Sync">
      <EntityType Name="Project">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="name" Type="Edm.String" Nullable="false" />
        <Property Name="status" Type="Edm.String" Nullable="false" />
        <Property Name="methodology" Type="Edm.String" Nullable="false" />
        <Property Name="cpi" Type="Edm.Double" />
        <Property Name="spi" Type="Edm.Double" />
        <Property Name="budget" Type="Edm.Decimal" Precision="14" Scale="2" />
        <Property Name="budgetCurrency" Type="Edm.String" />
        <Property Name="managerId" Type="Edm.String" />
        <Property Name="areaId" Type="Edm.String" />
        <Property Name="workspaceId" Type="Edm.String" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false" />
      </EntityType>
      <EntityType Name="Task">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="mnemonic" Type="Edm.String" />
        <Property Name="title" Type="Edm.String" Nullable="false" />
        <Property Name="status" Type="Edm.String" Nullable="false" />
        <Property Name="priority" Type="Edm.String" Nullable="false" />
        <Property Name="storyPoints" Type="Edm.Int32" />
        <Property Name="plannedValue" Type="Edm.Double" />
        <Property Name="actualCost" Type="Edm.Double" />
        <Property Name="earnedValue" Type="Edm.Double" />
        <Property Name="progress" Type="Edm.Int32" Nullable="false" />
        <Property Name="projectId" Type="Edm.String" Nullable="false" />
        <Property Name="sprintId" Type="Edm.String" />
        <Property Name="epicId" Type="Edm.String" />
        <Property Name="assigneeId" Type="Edm.String" />
        <Property Name="startDate" Type="Edm.DateTimeOffset" />
        <Property Name="endDate" Type="Edm.DateTimeOffset" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false" />
      </EntityType>
      <EntityType Name="Risk">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="projectId" Type="Edm.String" Nullable="false" />
        <Property Name="title" Type="Edm.String" Nullable="false" />
        <Property Name="probability" Type="Edm.Int32" Nullable="false" />
        <Property Name="impact" Type="Edm.Int32" Nullable="false" />
        <Property Name="score" Type="Edm.Int32" Nullable="false" />
        <Property Name="severity" Type="Edm.String" Nullable="false" />
        <Property Name="status" Type="Edm.String" Nullable="false" />
        <Property Name="ownerId" Type="Edm.String" />
        <Property Name="source" Type="Edm.String" Nullable="false" />
        <Property Name="detectedAt" Type="Edm.DateTimeOffset" />
        <Property Name="closedAt" Type="Edm.DateTimeOffset" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false" />
      </EntityType>
      <EntityType Name="EVMSnapshot">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="projectId" Type="Edm.String" Nullable="false" />
        <Property Name="snapshotDate" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="plannedValue" Type="Edm.Decimal" Precision="14" Scale="2" Nullable="false" />
        <Property Name="earnedValue" Type="Edm.Decimal" Precision="14" Scale="2" Nullable="false" />
        <Property Name="actualCost" Type="Edm.Decimal" Precision="14" Scale="2" Nullable="false" />
        <Property Name="budgetAtCompletion" Type="Edm.Decimal" Precision="14" Scale="2" />
        <Property Name="cpi" Type="Edm.Double" />
        <Property Name="spi" Type="Edm.Double" />
        <Property Name="estimateAtCompletion" Type="Edm.Decimal" Precision="14" Scale="2" />
        <Property Name="varianceAtCompletion" Type="Edm.Decimal" Precision="14" Scale="2" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Projects" EntityType="Sync.Project" />
        <EntitySet Name="Tasks" EntityType="Sync.Task" />
        <EntitySet Name="Risks" EntityType="Sync.Risk" />
        <EntitySet Name="EVMSnapshots" EntityType="Sync.EVMSnapshot" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`

function metadataResponse(): Response {
  return new Response(EDMX_DOC, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'OData-Version': '4.0',
      'X-API-Version': 'v2-odata',
      'Cache-Control': 'no-store',
    },
  })
}

// ─────────────────────────────────────────────────────────────────
// Filter field maps por entity (whitelist)
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

// ─────────────────────────────────────────────────────────────────
// Handler único
// ─────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entitySet: string }> },
): Promise<Response> {
  const { entitySet: rawEntity } = await params
  const entitySet = decodeURIComponent(rawEntity)

  // $metadata es público.
  if (entitySet === '$metadata') {
    return metadataResponse()
  }

  const gate = await odataAuth(request, 'read:exports')
  if (!gate.ok) return gate.response

  const url = new URL(request.url)
  const { top, skip } = parseTopSkip(url)
  const filterRaw = url.searchParams.get('$filter')

  try {
    switch (entitySet) {
      case 'Projects':
        return await handleProjects(request, gate.workspaceId, filterRaw, top, skip)
      case 'Tasks':
        return await handleTasks(request, gate.workspaceId, filterRaw, top, skip)
      case 'Risks':
        return await handleRisks(request, gate.workspaceId, filterRaw, top, skip)
      case 'EVMSnapshots':
        return await handleEVM(request, gate.workspaceId, filterRaw, top, skip)
      default:
        return odataError(
          'NOT_FOUND',
          `Entity set no encontrado: ${entitySet}. Disponibles: Projects, Tasks, Risks, EVMSnapshots`,
          404,
        )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return odataError('INTERNAL_ERROR', msg, 500)
  }
}

async function handleProjects(
  request: NextRequest,
  workspaceId: string,
  filterRaw: string | null,
  top: number,
  skip: number,
): Promise<Response> {
  const parsed = filterToPrismaWhere(filterRaw, PROJECT_FIELDS)
  if (!parsed.ok) return odataError('INVALID_INPUT', parsed.message)

  const where = { workspaceId, ...parsed.where }
  const rows = await prisma.project.findMany({
    where,
    orderBy: { id: 'asc' },
    take: top,
    skip,
    select: {
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
    },
  })
  return odataOk(request, 'Projects', rows.map(odataSerialize))
}

async function handleTasks(
  request: NextRequest,
  workspaceId: string,
  filterRaw: string | null,
  top: number,
  skip: number,
): Promise<Response> {
  const parsed = filterToPrismaWhere(filterRaw, TASK_FIELDS)
  if (!parsed.ok) return odataError('INVALID_INPUT', parsed.message)

  const where = { project: { workspaceId }, ...parsed.where }
  const rows = await prisma.task.findMany({
    where,
    orderBy: { id: 'asc' },
    take: top,
    skip,
    select: {
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
    },
  })
  return odataOk(request, 'Tasks', rows.map(odataSerialize))
}

async function handleRisks(
  request: NextRequest,
  workspaceId: string,
  filterRaw: string | null,
  top: number,
  skip: number,
): Promise<Response> {
  const parsed = filterToPrismaWhere(filterRaw, RISK_FIELDS)
  if (!parsed.ok) return odataError('INVALID_INPUT', parsed.message)

  const where = { project: { workspaceId }, ...parsed.where }
  const rows = await prisma.risk.findMany({
    where,
    orderBy: { id: 'asc' },
    take: top,
    skip,
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
  const enriched = rows.map((r) => {
    const score = r.probability * r.impact
    return odataSerialize({ ...r, score, severity: tierFromScore(score) })
  })
  return odataOk(request, 'Risks', enriched)
}

async function handleEVM(
  request: NextRequest,
  workspaceId: string,
  filterRaw: string | null,
  top: number,
  skip: number,
): Promise<Response> {
  const parsed = filterToPrismaWhere(filterRaw, EVM_FIELDS)
  if (!parsed.ok) return odataError('INVALID_INPUT', parsed.message)

  const where = { project: { workspaceId }, ...parsed.where }
  const rows = await prisma.eVMSnapshot.findMany({
    where,
    orderBy: { id: 'asc' },
    take: top,
    skip,
    select: {
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
    },
  })
  return odataOk(request, 'EVMSnapshots', rows.map(odataSerialize))
}
