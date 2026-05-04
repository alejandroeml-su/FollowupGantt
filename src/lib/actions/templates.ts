'use server'

/**
 * Ola P2 · Equipo P2-3 — Server actions para `TaskTemplate`.
 *
 * Permite crear, listar, actualizar y borrar plantillas reutilizables, así
 * como instanciar una nueva `Task` a partir del snapshot guardado en
 * `taskShape`.
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle` (ver `TemplateErrorCode`).
 *   - `revalidatePath('/templates')` y `revalidatePath('/list')` tras
 *     mutaciones que cambian la lista de templates o tareas instanciadas.
 *   - Validación con zod del shape mínimo del template; el `taskShape`
 *     se valida en su propio sub-schema (`taskShapeSchema`) para evitar
 *     basura sin estructura.
 *   - Sin auth real: `createdById` se resuelve con el mismo helper
 *     `resolveUserId` que ya usa `notifications.ts` (Edwin → fallback).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma, type TaskTemplate } from '@prisma/client'
import prisma from '@/lib/prisma'

// ─────────────────────────── Errores tipados ───────────────────────────

export type TemplateErrorCode =
  | 'INVALID_INPUT'
  | 'TEMPLATE_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'INVALID_TASK_SHAPE'
  | 'INTERNAL_ERROR'

function actionError(code: TemplateErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas ──────────────────────────────────

// Snapshot de un Task: subset suficiente para recrear una task nueva. Los
// campos cronograma (startDate/endDate) NO viven aquí — se calculan al
// instanciar a partir de `durationDays` y la fecha de creación.
const taskShapeSchema = z
  .object({
    title: z.string().trim().min(1, 'title es obligatorio').max(200),
    description: z.string().trim().max(5000).nullish(),
    type: z.enum(['AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET']).default('AGILE_STORY'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    durationDays: z.number().int().min(0).max(3650).optional(),
    isMilestone: z.boolean().optional().default(false),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
    referenceUrl: z.string().trim().max(500).nullish(),
    // Slots adicionales reservados para extensiones futuras (custom field
    // values, sub-tareas pre-definidas…). Se persisten tal cual.
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export type TemplateTaskShape = z.infer<typeof taskShapeSchema>

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(160),
  description: z.string().trim().max(2000).nullish(),
  projectId: z.string().min(1).nullish(),
  taskShape: taskShapeSchema,
  isShared: z.boolean().optional().default(false),
  createdById: z.string().min(1).optional(),
})

export type CreateTemplateInput = z.input<typeof createTemplateSchema>

const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).nullish(),
    projectId: z.string().min(1).nullish(),
    taskShape: taskShapeSchema.optional(),
    isShared: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debe especificar al menos un campo a actualizar',
  })

export type UpdateTemplateInput = z.input<typeof updateTemplateSchema>

const instantiateSchema = z.object({
  templateId: z.string().min(1),
  projectId: z.string().min(1),
  // Overrides opcionales aplicados sobre el `taskShape` base al crear.
  overrides: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      assigneeId: z.string().min(1).nullish(),
      startDate: z.string().min(1).nullish(),
      phaseId: z.string().min(1).nullish(),
      sprintId: z.string().min(1).nullish(),
    })
    .optional(),
  // Si la instancia proviene del scheduler, se enlaza para idempotencia.
  recurrenceRuleId: z.string().min(1).nullish(),
  occurrenceDate: z.date().optional(),
})

export type InstantiateFromTemplateInput = z.input<typeof instantiateSchema>

// ─────────────────────────── Helpers ───────────────────────────

/**
 * Resuelve el `userId` para `createdBy`. Replica la convención de
 * `notifications.ts` mientras no haya sesión real conectada.
 */
async function resolveUserId(userId?: string | null): Promise<string> {
  if (userId && userId.length > 0) return userId
  const edwin = await prisma.user.findFirst({
    where: { name: 'Edwin Martinez' },
    select: { id: true },
  })
  if (edwin) return edwin.id
  const fallback = await prisma.user.findFirst({
    orderBy: { name: 'asc' },
    select: { id: true },
  })
  if (!fallback) actionError('INTERNAL_ERROR', 'No hay usuarios en la base de datos')
  return fallback.id
}

function flattenZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
}

// ─────────────────────────── Reads ───────────────────────────

export async function listTemplates(opts?: {
  projectId?: string | null
  includeGlobal?: boolean
}): Promise<TaskTemplate[]> {
  const projectId = opts?.projectId ?? null
  const includeGlobal = opts?.includeGlobal ?? true

  if (projectId) {
    return prisma.taskTemplate.findMany({
      where: includeGlobal
        ? { OR: [{ projectId }, { projectId: null, isShared: true }] }
        : { projectId },
      orderBy: { createdAt: 'desc' },
    })
  }
  // Sin projectId: devolver todos los del usuario o compartidos.
  return prisma.taskTemplate.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

export async function getTemplate(id: string): Promise<TaskTemplate | null> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  return prisma.taskTemplate.findUnique({ where: { id } })
}

// ─────────────────────────── Mutations ───────────────────────────

export async function createTemplate(input: CreateTemplateInput): Promise<TaskTemplate> {
  const parsed = createTemplateSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', flattenZodError(parsed.error))
  }
  const data = parsed.data

  if (data.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { id: true },
    })
    if (!project) actionError('PROJECT_NOT_FOUND', `Proyecto ${data.projectId} no existe`)
  }

  const userId = await resolveUserId(data.createdById)

  const created = await prisma.taskTemplate.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      projectId: data.projectId ?? null,
      taskShape: data.taskShape as Prisma.InputJsonValue,
      isShared: data.isShared ?? false,
      createdById: userId,
    },
  })

  revalidatePath('/templates')
  return created
}

export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<TaskTemplate> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const parsed = updateTemplateSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', flattenZodError(parsed.error))
  }
  const data = parsed.data

  const existing = await prisma.taskTemplate.findUnique({ where: { id } })
  if (!existing) actionError('TEMPLATE_NOT_FOUND', `Template ${id} no existe`)

  if (data.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { id: true },
    })
    if (!project) actionError('PROJECT_NOT_FOUND', `Proyecto ${data.projectId} no existe`)
  }

  const updated = await prisma.taskTemplate.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description ?? null } : {}),
      ...(data.projectId !== undefined ? { projectId: data.projectId ?? null } : {}),
      ...(data.taskShape !== undefined
        ? { taskShape: data.taskShape as Prisma.InputJsonValue }
        : {}),
      ...(data.isShared !== undefined ? { isShared: data.isShared } : {}),
    },
  })

  revalidatePath('/templates')
  return updated
}

export async function deleteTemplate(id: string): Promise<{ id: string }> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const existing = await prisma.taskTemplate.findUnique({ where: { id } })
  if (!existing) actionError('TEMPLATE_NOT_FOUND', `Template ${id} no existe`)

  await prisma.taskTemplate.delete({ where: { id } })
  revalidatePath('/templates')
  return { id }
}

/**
 * Crea una nueva `Task` a partir del snapshot `taskShape` del template.
 *
 * Decisiones:
 *   - `startDate` se toma del override; si falta, se asume `now()` UTC.
 *   - `endDate` = `startDate + durationDays` cuando `durationDays` está
 *     definido y no es 0; si la tarea es milestone (`isMilestone=true`)
 *     forzamos `endDate = startDate`.
 *   - Cuando viene `recurrenceRuleId + occurrenceDate`, la creación
 *     enlaza ambos campos (el scheduler lo usa para idempotencia).
 */
export async function instantiateFromTemplate(
  input: InstantiateFromTemplateInput,
): Promise<{ taskId: string; alreadyExisted: boolean }> {
  const parsed = instantiateSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', flattenZodError(parsed.error))
  }
  const data = parsed.data

  const template = await prisma.taskTemplate.findUnique({ where: { id: data.templateId } })
  if (!template) actionError('TEMPLATE_NOT_FOUND', `Template ${data.templateId} no existe`)

  const project = await prisma.project.findUnique({
    where: { id: data.projectId },
    select: { id: true },
  })
  if (!project) actionError('PROJECT_NOT_FOUND', `Proyecto ${data.projectId} no existe`)

  const shapeParsed = taskShapeSchema.safeParse(template.taskShape)
  if (!shapeParsed.success) {
    actionError('INVALID_TASK_SHAPE', flattenZodError(shapeParsed.error))
  }
  const shape = shapeParsed.data
  const overrides = data.overrides ?? {}

  // Idempotencia para el scheduler: si ya existe una task con el mismo
  // (recurrenceRuleId, occurrenceDate), devolverla en lugar de crear.
  if (data.recurrenceRuleId && data.occurrenceDate) {
    const existing = await prisma.task.findFirst({
      where: {
        recurrenceRuleId: data.recurrenceRuleId,
        occurrenceDate: data.occurrenceDate,
      },
      select: { id: true },
    })
    if (existing) {
      return { taskId: existing.id, alreadyExisted: true }
    }
  }

  // Cálculo de fechas — el scheduler suele pasar `overrides.startDate` =
  // `occurrenceDate.toISOString()`. Si no, "ahora UTC midnight".
  let start: Date | null = null
  if (overrides.startDate) {
    const ts = Date.parse(overrides.startDate)
    if (Number.isNaN(ts)) actionError('INVALID_INPUT', 'startDate inválida')
    start = new Date(ts)
  } else if (data.occurrenceDate) {
    start = data.occurrenceDate
  } else {
    const now = new Date()
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }

  let end: Date | null = null
  if (shape.isMilestone) {
    end = start
  } else if (typeof shape.durationDays === 'number' && shape.durationDays > 0) {
    end = new Date(start.getTime())
    end.setUTCDate(end.getUTCDate() + shape.durationDays)
  }

  const created = await prisma.task.create({
    data: {
      title: overrides.title ?? shape.title,
      description: shape.description ?? null,
      type: shape.type,
      priority: shape.priority,
      isMilestone: shape.isMilestone ?? false,
      tags: shape.tags ?? [],
      referenceUrl: shape.referenceUrl ?? null,
      projectId: data.projectId,
      assigneeId: overrides.assigneeId ?? null,
      phaseId: overrides.phaseId ?? null,
      sprintId: overrides.sprintId ?? null,
      startDate: start,
      endDate: end,
      recurrenceRuleId: data.recurrenceRuleId ?? null,
      occurrenceDate: data.occurrenceDate ?? null,
    },
    select: { id: true },
  })

  revalidatePath('/list')
  revalidatePath('/gantt')
  return { taskId: created.id, alreadyExisted: false }
}
