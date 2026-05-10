'use server'

/**
 * Wave P18-A · Quality Inspections + Defect Tracking — Server actions.
 *
 * Convenciones del repo:
 *   - `'use server'` purity: solo exports async.
 *   - Errores tipados `[CODE] mensaje`.
 *   - Validación zod por entrada.
 *   - revalidatePath de las vistas afectadas.
 *
 * Decisiones (D-Q-1 .. D-Q-3):
 *   D-Q-1 · `checklist` es JSONB libre, validado por server action a un
 *           shape `{items: Array<{text: string, done: boolean, notes?:
 *           string}>}`. Permite plantillas distintas según `type`.
 *   D-Q-2 · Auto-set de `completedAt` cuando result transiciona de
 *           PENDING a algo distinto, y reset si vuelve a PENDING.
 *   D-Q-3 · Auto-set de `resolvedAt` cuando defect.status pasa a FIXED |
 *           WONT_FIX | DUPLICATE; reset si vuelve a OPEN/IN_REVIEW.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import {
  Prisma,
  type InspectionType,
  type InspectionResult,
  type DefectSeverity,
  type DefectStatus,
} from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
// Wave P18-C — Automation rule engine triggers.
import { dispatchEvent as dispatchAutomationEvent } from '@/lib/actions/automation'

// ───────────────────────── Errores tipados ─────────────────────────

export type QualityErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'INSPECTION_NOT_FOUND'

function actionError(code: QualityErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const INSPECTION_TYPES = [
  'CODE_REVIEW',
  'TEST_REVIEW',
  'DESIGN_REVIEW',
  'AUDIT',
  'WALKTHROUGH',
] as const satisfies readonly InspectionType[]

const INSPECTION_RESULTS = [
  'PENDING',
  'PASS',
  'PASS_WITH_DEFECTS',
  'FAIL',
] as const satisfies readonly InspectionResult[]

const DEFECT_SEVERITIES = [
  'CRITICAL',
  'MAJOR',
  'MINOR',
  'TRIVIAL',
] as const satisfies readonly DefectSeverity[]

const DEFECT_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'FIXED',
  'WONT_FIX',
  'DUPLICATE',
] as const satisfies readonly DefectStatus[]

const checklistItemSchema = z.object({
  text: z.string().trim().min(1).max(200),
  done: z.boolean(),
  notes: z.string().trim().max(500).optional().nullable(),
})

const checklistSchema = z
  .object({
    items: z.array(checklistItemSchema),
  })
  .nullable()
  .optional()

const createInspectionSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1).optional().nullable(),
  type: z.enum(INSPECTION_TYPES),
  inspectorId: z.string().min(1).optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  checklist: checklistSchema,
  summary: z.string().trim().max(2000).optional().nullable(),
})

export type CreateInspectionInput = z.input<typeof createInspectionSchema>

const updateInspectionSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1).nullable().optional(),
  type: z.enum(INSPECTION_TYPES).optional(),
  result: z.enum(INSPECTION_RESULTS).optional(),
  inspectorId: z.string().min(1).nullable().optional(),
  scheduledAt: z.string().nullable().optional(),
  checklist: checklistSchema,
  summary: z.string().trim().max(2000).nullable().optional(),
})

export type UpdateInspectionInput = z.input<typeof updateInspectionSchema>

const createDefectSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  severity: z.enum(DEFECT_SEVERITIES).optional(),
  status: z.enum(DEFECT_STATUSES).optional(),
  inspectionId: z.string().min(1).optional().nullable(),
  taskId: z.string().min(1).optional().nullable(),
  ownerId: z.string().min(1).optional().nullable(),
  reporterId: z.string().min(1).optional().nullable(),
})

export type CreateDefectInput = z.input<typeof createDefectSchema>

const updateDefectSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  severity: z.enum(DEFECT_SEVERITIES).optional(),
  status: z.enum(DEFECT_STATUSES).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  resolution: z.string().trim().max(2000).nullable().optional(),
})

export type UpdateDefectInput = z.input<typeof updateDefectSchema>

// ───────────────────────── Helpers ─────────────────────────

function revalidateQualityRoutes(projectId: string): void {
  revalidatePath(`/projects/${projectId}/quality`)
  revalidatePath('/quality')
}

async function ensureProjectExists(projectId: string): Promise<void> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })
  if (!p) actionError('PROJECT_NOT_FOUND', `Proyecto ${projectId} no existe`)
}

// ───────────────────── CRUD QualityInspection ─────────────────────

export async function createInspection(
  input: CreateInspectionInput,
): Promise<{ id: string }> {
  const parsed = createInspectionSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data
  await ensureProjectExists(data.projectId)

  const created = await prisma.qualityInspection.create({
    data: {
      projectId: data.projectId,
      taskId: data.taskId ?? null,
      type: data.type,
      result: 'PENDING',
      inspectorId: data.inspectorId ?? null,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      checklist: data.checklist ? (data.checklist as Prisma.InputJsonValue) : Prisma.JsonNull,
      summary: data.summary ?? null,
    },
    select: { id: true },
  })

  await recordAuditEventSafe({
    action: 'inspection.created',
    entityType: 'inspection',
    entityId: created.id,
    after: { projectId: data.projectId, type: data.type },
  })

  revalidateQualityRoutes(data.projectId)
  return created
}

export async function updateInspection(
  input: UpdateInspectionInput,
): Promise<void> {
  const parsed = updateInspectionSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const p = parsed.data

  const current = await prisma.qualityInspection.findUnique({
    where: { id: p.id },
    select: { id: true, projectId: true, result: true, completedAt: true },
  })
  if (!current) actionError('INSPECTION_NOT_FOUND', `Inspection ${p.id} no existe`)

  const data: Prisma.QualityInspectionUpdateInput = {}
  if (p.taskId !== undefined) {
    data.task = p.taskId
      ? { connect: { id: p.taskId } }
      : { disconnect: true }
  }
  if (p.type !== undefined) data.type = p.type
  if (p.inspectorId !== undefined) {
    data.inspector = p.inspectorId
      ? { connect: { id: p.inspectorId } }
      : { disconnect: true }
  }
  if (p.scheduledAt !== undefined) {
    data.scheduledAt = p.scheduledAt ? new Date(p.scheduledAt) : null
  }
  if (p.checklist !== undefined) {
    data.checklist = p.checklist
      ? (p.checklist as Prisma.InputJsonValue)
      : Prisma.JsonNull
  }
  if (p.summary !== undefined) data.summary = p.summary
  if (p.result !== undefined) {
    data.result = p.result
    // D-Q-2: gestionar completedAt automáticamente.
    if (p.result !== 'PENDING' && !current.completedAt) {
      data.completedAt = new Date()
    } else if (p.result === 'PENDING' && current.completedAt) {
      data.completedAt = null
    }
  }

  await prisma.qualityInspection.update({ where: { id: p.id }, data })

  await recordAuditEventSafe({
    action: 'inspection.updated',
    entityType: 'inspection',
    entityId: p.id,
    before: { result: current.result },
    after: { result: p.result ?? current.result },
  })

  revalidateQualityRoutes(current.projectId)
}

export async function deleteInspection(input: { id: string }): Promise<void> {
  const existing = await prisma.qualityInspection.findUnique({
    where: { id: input.id },
    select: { projectId: true },
  })
  if (!existing) actionError('INSPECTION_NOT_FOUND', `Inspection ${input.id} no existe`)

  await prisma.qualityInspection.delete({ where: { id: input.id } })

  await recordAuditEventSafe({
    action: 'inspection.deleted',
    entityType: 'inspection',
    entityId: input.id,
  })

  revalidateQualityRoutes(existing.projectId)
}

// ─────────────────────────── CRUD Defect ───────────────────────────

export async function createDefect(input: CreateDefectInput): Promise<{ id: string }> {
  const parsed = createDefectSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data
  await ensureProjectExists(data.projectId)

  const created = await prisma.defect.create({
    data: {
      projectId: data.projectId,
      title: data.title,
      description: data.description ?? null,
      severity: data.severity ?? 'MAJOR',
      status: data.status ?? 'OPEN',
      inspectionId: data.inspectionId ?? null,
      taskId: data.taskId ?? null,
      ownerId: data.ownerId ?? null,
      reporterId: data.reporterId ?? null,
    },
    select: { id: true },
  })

  await recordAuditEventSafe({
    action: 'defect.created',
    entityType: 'defect',
    entityId: created.id,
    after: {
      projectId: data.projectId,
      title: data.title.slice(0, 100),
      severity: data.severity ?? 'MAJOR',
    },
  })

  // Wave P18-C — trigger automation rules cuando se reporta un defect CRITICAL.
  if ((data.severity ?? 'MAJOR') === 'CRITICAL') {
    void dispatchAutomationEvent('defect.critical', {
      triggeredBy: `defect:${created.id}`,
      data: {
        defectId: created.id,
        projectId: data.projectId,
        title: data.title,
        taskId: data.taskId ?? null,
      },
    })
  }

  revalidateQualityRoutes(data.projectId)
  return created
}

export async function updateDefect(input: UpdateDefectInput): Promise<void> {
  const parsed = updateDefectSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const p = parsed.data

  const current = await prisma.defect.findUnique({
    where: { id: p.id },
    select: {
      id: true,
      projectId: true,
      status: true,
      severity: true,
      title: true,
      taskId: true,
      resolvedAt: true,
    },
  })
  if (!current) actionError('NOT_FOUND', `Defect ${p.id} no existe`)

  const data: Prisma.DefectUpdateInput = {}
  if (p.title !== undefined) data.title = p.title
  if (p.description !== undefined) data.description = p.description
  if (p.severity !== undefined) data.severity = p.severity
  if (p.resolution !== undefined) data.resolution = p.resolution
  if (p.ownerId !== undefined) {
    data.owner = p.ownerId
      ? { connect: { id: p.ownerId } }
      : { disconnect: true }
  }
  if (p.status !== undefined) {
    data.status = p.status
    // D-Q-3: gestionar resolvedAt automáticamente.
    const resolvedStatuses: DefectStatus[] = ['FIXED', 'WONT_FIX', 'DUPLICATE']
    const isResolved = resolvedStatuses.includes(p.status)
    const wasResolved = !!current.resolvedAt
    if (isResolved && !wasResolved) {
      data.resolvedAt = new Date()
    } else if (!isResolved && wasResolved) {
      data.resolvedAt = null
    }
  }

  await prisma.defect.update({ where: { id: p.id }, data })

  await recordAuditEventSafe({
    action: 'defect.updated',
    entityType: 'defect',
    entityId: p.id,
    before: { status: current.status },
    after: { status: p.status ?? current.status },
  })

  // Wave P18-C — trigger automation rules cuando un defect pasa a CRITICAL
  // (transición de severity, no en cada update). Evita spam si ya era CRITICAL.
  if (p.severity === 'CRITICAL' && current.severity !== 'CRITICAL') {
    void dispatchAutomationEvent('defect.critical', {
      triggeredBy: `defect:${p.id}`,
      data: {
        defectId: p.id,
        projectId: current.projectId,
        title: current.title,
        taskId: current.taskId,
        previousSeverity: current.severity,
      },
    })
  }

  revalidateQualityRoutes(current.projectId)
}

export async function deleteDefect(input: { id: string }): Promise<void> {
  const existing = await prisma.defect.findUnique({
    where: { id: input.id },
    select: { projectId: true },
  })
  if (!existing) actionError('NOT_FOUND', `Defect ${input.id} no existe`)

  await prisma.defect.delete({ where: { id: input.id } })

  await recordAuditEventSafe({
    action: 'defect.deleted',
    entityType: 'defect',
    entityId: input.id,
  })

  revalidateQualityRoutes(existing.projectId)
}

// ───────────────────────── Queries ─────────────────────────

export async function listInspectionsForProject(projectId: string) {
  if (!projectId) return []
  return prisma.qualityInspection.findMany({
    where: { projectId },
    orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      inspector: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, mnemonic: true } },
      _count: { select: { defects: true } },
    },
  })
}

export async function listDefectsForProject(projectId: string) {
  if (!projectId) return []
  return prisma.defect.findMany({
    where: { projectId },
    orderBy: [
      { status: 'asc' },
      { severity: 'asc' },
      { createdAt: 'desc' },
    ],
    include: {
      owner: { select: { id: true, name: true } },
      reporter: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, mnemonic: true } },
      inspection: { select: { id: true, type: true } },
    },
  })
}
