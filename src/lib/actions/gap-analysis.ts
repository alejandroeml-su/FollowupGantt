'use server'

/**
 * US-9.2 · Wave R5 — Server actions del módulo Gap Analysis.
 *
 * Implementa el CRUD del modelo `GapAnalysis` + `GapDimension` +
 * `GapDimensionAction`, el refresh de auto-metrics y el export a Excel.
 *
 * Errores tipados (consistente con la convención del repo):
 *   - [UNAUTHORIZED]            sesión faltante.
 *   - [FORBIDDEN]               sin acceso al proyecto.
 *   - [NOT_FOUND]               recurso inexistente.
 *   - [INVALID_INPUT]           zod falló.
 *   - [INVALID_METRIC_KEY]      metricKey fuera del catálogo AUTO_METRICS.
 *   - [INVALID_TRANSITION]      cambio de status no permitido (reservado).
 *
 * RBAC: TODA operación valida visibilidad del proyecto vía
 * `requireProjectAccess(projectId)`. Listados cross-project pasan por
 * `resolveProjectVisibility` para inyectar el `projectId IN (...)`.
 *
 * Observabilidad: cada action se envuelve con `withMetrics` y dispara
 * audit events vía `recordAuditEventSafe` (best-effort).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import ExcelJS from 'exceljs'
import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { requireUser, getCurrentUser } from '@/lib/auth/get-current-user'
import { resolveProjectVisibility } from '@/lib/auth/visibility'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { withMetrics } from '@/lib/observability/metrics'

import {
  AUTO_METRIC_KEYS,
  findAutoMetric,
} from '@/lib/gap-analysis/auto-metrics'
import {
  computeGapColor,
  computeGapMagnitude,
  type SerializedGapAnalysis,
  type SerializedGapDimension,
  type SerializedGapDimensionAction,
} from '@/lib/gap-analysis/types'

// ───────────────────────── Errores ─────────────────────────

type GapErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_METRIC_KEY'

function actionError(code: GapErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const GAP_STATUS_VALUES = ['DRAFT', 'IN_PROGRESS', 'COMPLETED'] as const
const KIND_VALUES = ['AUTO', 'MANUAL'] as const
const ACTION_STATUS_VALUES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const

const createGapSchema = z.object({
  projectId: z.string().min(1, 'projectId es obligatorio'),
  name: z.string().trim().min(1, 'name obligatorio').max(200),
  description: z.string().trim().max(2000).nullish(),
  targetDate: z
    .union([z.string(), z.date()])
    .transform((v) => (v ? new Date(v) : null))
    .nullish(),
  status: z.enum(GAP_STATUS_VALUES).optional(),
})

const updateGapSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  targetDate: z
    .union([z.string(), z.date(), z.null()])
    .transform((v) => (v ? new Date(v as string | Date) : null))
    .optional(),
  status: z.enum(GAP_STATUS_VALUES).optional(),
})

const addDimensionSchema = z.object({
  gapAnalysisId: z.string().min(1),
  name: z.string().trim().min(1, 'name obligatorio').max(200),
  category: z.string().trim().max(80).nullish(),
  kind: z.enum(KIND_VALUES).optional(),
  metricKey: z.string().min(1).nullish(),
  asIsValue: z.number().finite().nullish(),
  toBeValue: z.number().finite().nullish(),
  unit: z.string().trim().max(20).nullish(),
  weight: z.number().int().min(1).max(10).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  position: z.number().int().min(0).max(9999).optional(),
})

const updateDimensionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(80).nullable().optional(),
  kind: z.enum(KIND_VALUES).optional(),
  metricKey: z.string().min(1).nullable().optional(),
  asIsValue: z.number().finite().nullable().optional(),
  toBeValue: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  weight: z.number().int().min(1).max(10).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  position: z.number().int().min(0).max(9999).optional(),
})

const linkActionSchema = z.object({
  dimensionId: z.string().min(1),
  taskId: z.string().min(1).nullish(),
  freeText: z.string().trim().max(500).nullish(),
  status: z.enum(ACTION_STATUS_VALUES).optional(),
})

// ───────────────────────── Helpers ─────────────────────────

function revalidateGapRoutes(gapId?: string): void {
  revalidatePath('/gap-analysis')
  if (gapId) revalidatePath(`/gap-analysis/${gapId}`)
}

type GapAnalysisRow = Prisma.GapAnalysisGetPayload<{
  include: {
    project: { select: { id: true; name: true } }
    createdBy: { select: { id: true; name: true } }
    dimensions: {
      include: {
        actions: {
          include: { task: { select: { id: true; title: true } } }
        }
      }
    }
  }
}>

function serializeAction(
  row: GapAnalysisRow['dimensions'][number]['actions'][number],
): SerializedGapDimensionAction {
  return {
    id: row.id,
    dimensionId: row.dimensionId,
    taskId: row.taskId,
    taskTitle: row.task?.title ?? null,
    freeText: row.freeText,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeDimension(
  row: GapAnalysisRow['dimensions'][number],
): SerializedGapDimension {
  return {
    id: row.id,
    gapAnalysisId: row.gapAnalysisId,
    name: row.name,
    category: row.category,
    kind: row.kind,
    metricKey: row.metricKey,
    asIsValue: row.asIsValue,
    toBeValue: row.toBeValue,
    unit: row.unit,
    weight: row.weight,
    notes: row.notes,
    metricMetadata:
      (row.metricMetadata as Record<string, unknown> | null) ?? null,
    position: row.position,
    gap: computeGapMagnitude(row.asIsValue, row.toBeValue),
    color: computeGapColor(row.asIsValue, row.toBeValue),
    actions: row.actions.map(serializeAction),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeGapAnalysis(row: GapAnalysisRow): SerializedGapAnalysis {
  const dims = row.dimensions
    .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
    .map(serializeDimension)

  // overallScore = % de dimensiones con color === 'green', sólo sobre
  // dimensiones comparables (asIs y toBe definidos).
  const comparable = dims.filter(
    (d) => d.asIsValue != null && d.toBeValue != null,
  )
  let overallScore: number | null = null
  if (comparable.length > 0) {
    const greens = comparable.filter((d) => d.color === 'green').length
    overallScore = Number(((greens / comparable.length) * 100).toFixed(2))
  }

  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    name: row.name,
    description: row.description,
    targetDate: row.targetDate?.toISOString() ?? null,
    status: row.status,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    dimensions: dims,
    overallScore,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const FULL_INCLUDE = {
  project: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  dimensions: {
    include: {
      actions: {
        include: { task: { select: { id: true, title: true } } },
      },
    },
  },
} satisfies Prisma.GapAnalysisInclude

async function loadGapOrThrow(id: string): Promise<GapAnalysisRow> {
  const row = await prisma.gapAnalysis.findUnique({
    where: { id },
    include: FULL_INCLUDE,
  })
  if (!row) actionError('NOT_FOUND', `Gap Analysis ${id} no existe`)
  return row
}

// ───────────────────────── Queries ─────────────────────────

/**
 * Lista los análisis visibles para el usuario actual. Aplica RBAC vía
 * `resolveProjectVisibility` (taskWhere/projectWhere). Soporta filtro
 * opcional `projectId` para listar por proyecto.
 */
export async function listGapAnalyses(input?: {
  projectId?: string | null
}): Promise<SerializedGapAnalysis[]> {
  return withMetrics('action.listGapAnalyses', async () => {
    const user = await getCurrentUser()
    if (!user) return []
    const visibility = await resolveProjectVisibility(user)

    const where: Prisma.GapAnalysisWhereInput = {}
    if (input?.projectId) where.projectId = input.projectId
    if (!visibility.unrestricted) {
      where.projectId = where.projectId
        ? where.projectId
        : { in: visibility.visibleIds }
    }
    // Si el caller pidió un projectId que no es visible, devolvemos lista vacía.
    if (
      input?.projectId &&
      !visibility.unrestricted &&
      !visibility.visibleIds.includes(input.projectId)
    ) {
      return []
    }

    const rows = await prisma.gapAnalysis.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: FULL_INCLUDE,
    })
    return rows.map(serializeGapAnalysis)
  })
}

export async function getGapAnalysisById(
  id: string,
): Promise<SerializedGapAnalysis | null> {
  return withMetrics('action.getGapAnalysisById', async () => {
    if (!id) return null
    const row = await prisma.gapAnalysis.findUnique({
      where: { id },
      include: FULL_INCLUDE,
    })
    if (!row) return null
    // RBAC: validamos visibilidad del proyecto al que pertenece.
    await requireProjectAccess(row.projectId)
    return serializeGapAnalysis(row)
  })
}

// ───────────────────────── Mutations · GapAnalysis ─────────────────────────

export async function createGapAnalysis(
  input: z.input<typeof createGapSchema>,
): Promise<{ id: string }> {
  return withMetrics('action.createGapAnalysis', async () => {
    const parsed = createGapSchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const data = parsed.data
    const user = await requireProjectAccess(data.projectId)

    const created = await prisma.gapAnalysis.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        description: data.description ?? null,
        targetDate: data.targetDate ?? null,
        status: data.status ?? 'DRAFT',
        createdById: user.id,
      },
      select: { id: true },
    })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.created',
      entityType: 'gap_analysis',
      entityId: created.id,
      after: { projectId: data.projectId, name: data.name },
    })

    revalidateGapRoutes(created.id)
    return created
  })
}

export async function updateGapAnalysis(
  id: string,
  patch: z.input<typeof updateGapSchema>,
): Promise<void> {
  return withMetrics('action.updateGapAnalysis', async () => {
    if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
    const parsed = updateGapSchema.safeParse(patch)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const p = parsed.data

    const current = await prisma.gapAnalysis.findUnique({
      where: { id },
      select: { id: true, projectId: true, name: true, status: true },
    })
    if (!current) actionError('NOT_FOUND', `Gap Analysis ${id} no existe`)

    const user = await requireProjectAccess(current.projectId)

    await prisma.gapAnalysis.update({
      where: { id },
      data: {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.description !== undefined
          ? { description: p.description }
          : {}),
        ...(p.targetDate !== undefined ? { targetDate: p.targetDate } : {}),
        ...(p.status !== undefined ? { status: p.status } : {}),
      },
    })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.updated',
      entityType: 'gap_analysis',
      entityId: id,
      before: { name: current.name, status: current.status },
      after: p as Record<string, unknown>,
    })

    revalidateGapRoutes(id)
  })
}

export async function deleteGapAnalysis(id: string): Promise<void> {
  return withMetrics('action.deleteGapAnalysis', async () => {
    if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
    const current = await prisma.gapAnalysis.findUnique({
      where: { id },
      select: { id: true, projectId: true, name: true },
    })
    if (!current) actionError('NOT_FOUND', `Gap Analysis ${id} no existe`)

    const user = await requireProjectAccess(current.projectId)

    await prisma.gapAnalysis.delete({ where: { id } })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.deleted',
      entityType: 'gap_analysis',
      entityId: id,
      before: { name: current.name, projectId: current.projectId },
    })

    revalidateGapRoutes(id)
  })
}

// ───────────────────────── Mutations · GapDimension ─────────────────────────

export async function addDimension(
  input: z.input<typeof addDimensionSchema>,
): Promise<{ id: string }> {
  return withMetrics('action.addDimension', async () => {
    const parsed = addDimensionSchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const data = parsed.data

    const gap = await prisma.gapAnalysis.findUnique({
      where: { id: data.gapAnalysisId },
      select: { id: true, projectId: true },
    })
    if (!gap) actionError('NOT_FOUND', `Gap Analysis ${data.gapAnalysisId} no existe`)
    const user = await requireProjectAccess(gap.projectId)

    // Si kind=AUTO obligamos que metricKey esté en el catálogo.
    if (data.kind === 'AUTO') {
      if (!data.metricKey || !AUTO_METRIC_KEYS.includes(data.metricKey)) {
        actionError(
          'INVALID_METRIC_KEY',
          `metricKey '${data.metricKey ?? '∅'}' no está en el catálogo`,
        )
      }
    }

    const position =
      data.position ??
      ((await prisma.gapDimension.count({
        where: { gapAnalysisId: data.gapAnalysisId },
      })) +
        1)

    const created = await prisma.gapDimension.create({
      data: {
        gapAnalysisId: data.gapAnalysisId,
        name: data.name,
        category: data.category ?? null,
        kind: data.kind ?? 'MANUAL',
        metricKey: data.metricKey ?? null,
        asIsValue: data.asIsValue ?? null,
        toBeValue: data.toBeValue ?? null,
        unit: data.unit ?? null,
        weight: data.weight ?? null,
        notes: data.notes ?? null,
        position,
      },
      select: { id: true },
    })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.updated',
      entityType: 'gap_dimension',
      entityId: created.id,
      after: {
        gapAnalysisId: data.gapAnalysisId,
        name: data.name,
        kind: data.kind ?? 'MANUAL',
      },
    })

    revalidateGapRoutes(data.gapAnalysisId)
    return created
  })
}

export async function updateDimension(
  id: string,
  patch: z.input<typeof updateDimensionSchema>,
): Promise<void> {
  return withMetrics('action.updateDimension', async () => {
    if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
    const parsed = updateDimensionSchema.safeParse(patch)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const p = parsed.data

    const dim = await prisma.gapDimension.findUnique({
      where: { id },
      select: {
        id: true,
        gapAnalysisId: true,
        kind: true,
        metricKey: true,
        name: true,
        gapAnalysis: { select: { projectId: true } },
      },
    })
    if (!dim) actionError('NOT_FOUND', `Dimension ${id} no existe`)
    const user = await requireProjectAccess(dim.gapAnalysis.projectId)

    // Si el patch convierte la dimensión a AUTO o cambia su metricKey,
    // validamos contra el catálogo.
    const newKind = p.kind ?? dim.kind
    const newKey = p.metricKey ?? dim.metricKey
    if (newKind === 'AUTO') {
      if (!newKey || !AUTO_METRIC_KEYS.includes(newKey)) {
        actionError(
          'INVALID_METRIC_KEY',
          `metricKey '${newKey ?? '∅'}' no está en el catálogo`,
        )
      }
    }

    await prisma.gapDimension.update({
      where: { id },
      data: {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.category !== undefined ? { category: p.category } : {}),
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        ...(p.metricKey !== undefined ? { metricKey: p.metricKey } : {}),
        ...(p.asIsValue !== undefined ? { asIsValue: p.asIsValue } : {}),
        ...(p.toBeValue !== undefined ? { toBeValue: p.toBeValue } : {}),
        ...(p.unit !== undefined ? { unit: p.unit } : {}),
        ...(p.weight !== undefined ? { weight: p.weight } : {}),
        ...(p.notes !== undefined ? { notes: p.notes } : {}),
        ...(p.position !== undefined ? { position: p.position } : {}),
      },
    })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.updated',
      entityType: 'gap_dimension',
      entityId: id,
      before: { name: dim.name, kind: dim.kind, metricKey: dim.metricKey },
      after: p as Record<string, unknown>,
    })

    revalidateGapRoutes(dim.gapAnalysisId)
  })
}

export async function removeDimension(id: string): Promise<void> {
  return withMetrics('action.removeDimension', async () => {
    if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
    const dim = await prisma.gapDimension.findUnique({
      where: { id },
      select: {
        id: true,
        gapAnalysisId: true,
        name: true,
        gapAnalysis: { select: { projectId: true } },
      },
    })
    if (!dim) actionError('NOT_FOUND', `Dimension ${id} no existe`)
    const user = await requireProjectAccess(dim.gapAnalysis.projectId)

    await prisma.gapDimension.delete({ where: { id } })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.updated',
      entityType: 'gap_dimension',
      entityId: id,
      before: { name: dim.name, deleted: true },
    })

    revalidateGapRoutes(dim.gapAnalysisId)
  })
}

// ───────────────────────── Mutations · GapDimensionAction ─────────────────────────

/**
 * Vincula una dimensión con una task existente o crea una acción libre
 * (`freeText`). Al menos uno de los dos debe estar presente.
 */
export async function linkDimensionToTask(
  input: z.input<typeof linkActionSchema>,
): Promise<{ id: string }> {
  return withMetrics('action.linkDimensionToTask', async () => {
    const parsed = linkActionSchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const data = parsed.data

    if (!data.taskId && !data.freeText) {
      actionError(
        'INVALID_INPUT',
        'Se requiere taskId o freeText para crear la acción',
      )
    }

    const dim = await prisma.gapDimension.findUnique({
      where: { id: data.dimensionId },
      select: {
        id: true,
        gapAnalysisId: true,
        gapAnalysis: { select: { projectId: true } },
      },
    })
    if (!dim) actionError('NOT_FOUND', `Dimension ${data.dimensionId} no existe`)
    const user = await requireProjectAccess(dim.gapAnalysis.projectId)

    // Si se da taskId, validamos que la tarea pertenezca al MISMO proyecto.
    if (data.taskId) {
      const task = await prisma.task.findUnique({
        where: { id: data.taskId },
        select: { id: true, projectId: true },
      })
      if (!task) actionError('NOT_FOUND', `Task ${data.taskId} no existe`)
      if (task.projectId !== dim.gapAnalysis.projectId) {
        actionError(
          'INVALID_INPUT',
          'La tarea pertenece a otro proyecto distinto del análisis',
        )
      }
    }

    const created = await prisma.gapDimensionAction.create({
      data: {
        dimensionId: data.dimensionId,
        taskId: data.taskId ?? null,
        freeText: data.freeText ?? null,
        status: data.status ?? 'OPEN',
      },
      select: { id: true },
    })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.updated',
      entityType: 'gap_dimension_action',
      entityId: created.id,
      after: {
        dimensionId: data.dimensionId,
        taskId: data.taskId ?? null,
      },
    })

    revalidateGapRoutes(dim.gapAnalysisId)
    return created
  })
}

export async function removeDimensionAction(id: string): Promise<void> {
  return withMetrics('action.removeDimensionAction', async () => {
    if (!id) actionError('INVALID_INPUT', 'id es obligatorio')
    const action = await prisma.gapDimensionAction.findUnique({
      where: { id },
      select: {
        id: true,
        dimension: {
          select: {
            id: true,
            gapAnalysisId: true,
            gapAnalysis: { select: { projectId: true } },
          },
        },
      },
    })
    if (!action) actionError('NOT_FOUND', `Action ${id} no existe`)
    const user = await requireProjectAccess(
      action.dimension.gapAnalysis.projectId,
    )
    await prisma.gapDimensionAction.delete({ where: { id } })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.updated',
      entityType: 'gap_dimension_action',
      entityId: id,
      before: { deleted: true },
    })

    revalidateGapRoutes(action.dimension.gapAnalysisId)
  })
}

// ───────────────────────── Auto-metrics recalc ─────────────────────────

/**
 * Recalcula `asIsValue` para todas las dimensiones AUTO del análisis.
 * No toca dimensiones MANUAL. Se invoca SOLO bajo botón "Refresh"
 * explícito del usuario (no en cada render).
 */
export async function recalculateAutoMetrics(gapAnalysisId: string): Promise<{
  refreshed: number
  skipped: number
}> {
  return withMetrics('action.recalculateAutoMetrics', async () => {
    if (!gapAnalysisId) actionError('INVALID_INPUT', 'gapAnalysisId es obligatorio')
    const gap = await prisma.gapAnalysis.findUnique({
      where: { id: gapAnalysisId },
      select: { id: true, projectId: true },
    })
    if (!gap) actionError('NOT_FOUND', `Gap Analysis ${gapAnalysisId} no existe`)
    const user = await requireProjectAccess(gap.projectId)

    const dims = await prisma.gapDimension.findMany({
      where: { gapAnalysisId, kind: 'AUTO' },
      select: { id: true, metricKey: true },
    })

    let refreshed = 0
    let skipped = 0
    for (const d of dims) {
      if (!d.metricKey) {
        skipped += 1
        continue
      }
      const def = findAutoMetric(d.metricKey)
      if (!def) {
        skipped += 1
        continue
      }
      const result = await def.compute(gap.projectId)
      await prisma.gapDimension.update({
        where: { id: d.id },
        data: {
          asIsValue: result.value,
          unit: result.unit,
          metricMetadata: {
            computedAt: new Date().toISOString(),
            sampleSize: result.sampleSize,
            totalCandidates: result.totalCandidates,
            formula: result.formula,
          } as Prisma.InputJsonValue,
        },
      })
      refreshed += 1
    }

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.dimension_recalculated',
      entityType: 'gap_analysis',
      entityId: gapAnalysisId,
      metadata: { refreshed, skipped },
    })

    revalidateGapRoutes(gapAnalysisId)
    return { refreshed, skipped }
  })
}

// ───────────────────────── Excel export ─────────────────────────

/**
 * Genera un workbook con dos hojas:
 *   1. "Resumen" — meta del análisis + porcentaje overall.
 *   2. "Dimensiones" — tabla AS-IS / TO-BE / gap / color / acciones.
 *
 * Devuelve `{ filename, base64 }` consistente con
 * `exportWeekTimesheet` para que el cliente decodifique y dispare la
 * descarga vía Blob.
 */
export async function exportGapAnalysisExcel(
  gapAnalysisId: string,
): Promise<{ filename: string; base64: string }> {
  return withMetrics('action.exportGapAnalysisExcel', async () => {
    if (!gapAnalysisId) actionError('INVALID_INPUT', 'gapAnalysisId es obligatorio')
    const gap = await loadGapOrThrow(gapAnalysisId)
    const user = await requireProjectAccess(gap.projectId)

    const serialized = serializeGapAnalysis(gap)

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Sync'
    wb.created = new Date()
    wb.title = `Gap Analysis · ${serialized.name}`

    // ── Resumen ──
    const summary = wb.addWorksheet('Resumen')
    summary.columns = [
      { header: 'Campo', key: 'field', width: 24 },
      { header: 'Valor', key: 'value', width: 50 },
    ]
    summary.getRow(1).eachCell((c) => (c.font = { bold: true }))
    summary.addRow({ field: 'Análisis', value: serialized.name })
    summary.addRow({
      field: 'Proyecto',
      value: serialized.projectName ?? serialized.projectId,
    })
    summary.addRow({
      field: 'Descripción',
      value: serialized.description ?? '',
    })
    summary.addRow({ field: 'Estado', value: serialized.status })
    summary.addRow({
      field: 'Fecha objetivo',
      value: serialized.targetDate
        ? new Date(serialized.targetDate).toLocaleDateString('es-MX')
        : '—',
    })
    summary.addRow({
      field: 'Score global',
      value:
        serialized.overallScore != null
          ? `${serialized.overallScore.toFixed(2)}%`
          : '—',
    })
    summary.addRow({
      field: 'Creado por',
      value: serialized.createdByName ?? '—',
    })

    // ── Dimensiones ──
    const dims = wb.addWorksheet('Dimensiones')
    dims.columns = [
      { header: '#', key: 'pos', width: 6 },
      { header: 'Dimensión', key: 'name', width: 32 },
      { header: 'Categoría', key: 'category', width: 18 },
      { header: 'Tipo', key: 'kind', width: 10 },
      { header: 'Métrica auto', key: 'metricKey', width: 24 },
      { header: 'AS-IS', key: 'asIs', width: 12, style: { numFmt: '0.00' } },
      { header: 'TO-BE', key: 'toBe', width: 12, style: { numFmt: '0.00' } },
      { header: 'Gap', key: 'gap', width: 12, style: { numFmt: '0.00' } },
      { header: 'Color', key: 'color', width: 10 },
      { header: 'Unidad', key: 'unit', width: 10 },
      { header: 'Peso', key: 'weight', width: 8 },
      { header: 'Notas', key: 'notes', width: 40 },
      { header: 'Acciones', key: 'actions', width: 50 },
    ]
    dims.getRow(1).eachCell((c) => (c.font = { bold: true }))

    for (const d of serialized.dimensions) {
      const actionLabel = d.actions
        .map((a) => {
          const lbl = a.taskTitle ?? a.freeText ?? ''
          return `${lbl} [${a.status}]`
        })
        .join(' · ')
      const row = dims.addRow({
        pos: d.position,
        name: d.name,
        category: d.category ?? '',
        kind: d.kind,
        metricKey: d.metricKey ?? '',
        asIs: d.asIsValue,
        toBe: d.toBeValue,
        gap: d.gap,
        color: d.color,
        unit: d.unit ?? '',
        weight: d.weight ?? '',
        notes: d.notes ?? '',
        actions: actionLabel,
      })
      // Pintar la celda "Color" con su color cualitativo para que el
      // usuario lo vea de un vistazo al abrir el archivo en Excel.
      const colorCell = row.getCell('color')
      const fillByColor: Record<string, string> = {
        green: 'FF22C55E',
        amber: 'FFF59E0B',
        red: 'FFEF4444',
        neutral: 'FF9CA3AF',
      }
      const argb = fillByColor[d.color] ?? 'FF9CA3AF'
      colorCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb },
      }
      colorCell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    }

    const buffer = await wb.xlsx.writeBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const safeName = serialized.name.replace(/[^a-zA-Z0-9_-]+/g, '_')
    const filename = `gap-analysis_${safeName}_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'gap.exported',
      entityType: 'gap_analysis',
      entityId: gapAnalysisId,
      metadata: { filename, dimensionsExported: serialized.dimensions.length },
    })

    return { filename, base64 }
  })
}

// ───────────────────────── Helpers extra ─────────────────────────

/**
 * Devuelve la lista de tasks del proyecto ordenadas por título para
 * llenar el selector de "Vincular acción a tarea". Pensada para el
 * componente cliente.
 */
export async function listProjectTasksForLinking(
  projectId: string,
): Promise<Array<{ id: string; title: string; mnemonic: string | null }>> {
  return withMetrics('action.listProjectTasksForLinking', async () => {
    if (!projectId) return []
    await requireProjectAccess(projectId)
    const tasks = await prisma.task.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, title: true, mnemonic: true },
      orderBy: [{ mnemonic: 'asc' }, { title: 'asc' }],
      take: 500,
    })
    return tasks
  })
}

/**
 * Devuelve la lista de proyectos visibles para el usuario actual para
 * llenar el dropdown del modal de "Nuevo análisis".
 */
export async function listVisibleProjectsForGap(): Promise<
  Array<{ id: string; name: string }>
> {
  return withMetrics('action.listVisibleProjectsForGap', async () => {
    const user = await requireUser()
    const visibility = await resolveProjectVisibility(user)
    const projects = await prisma.project.findMany({
      where: visibility.unrestricted
        ? {}
        : { id: { in: visibility.visibleIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    return projects
  })
}
