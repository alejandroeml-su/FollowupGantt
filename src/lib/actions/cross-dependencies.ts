'use server'

/**
 * Wave P10 (HU-10.4 · GAMMA-2.2) — Server actions para
 * `CrossProjectDependency` (dependencias programa entre proyectos).
 *
 * NO toca el modelo `Dependency` clásico (intra-project), solo opera sobre
 * la tabla nueva. La detección de ciclos transitiva sobre grafo combinado
 * (CrossProjectDependency + Dependency) se deja para follow-up; aquí
 * validamos solo ciclo directo (A→B y B→A) y self-loop.
 */

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { recordAuditEventSafe } from '@/lib/audit/events'

export type CrossDepErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'SELF_LOOP'
  | 'DIRECT_CYCLE'
  | 'SAME_PROJECT'
  | 'DUPLICATE'

function actionError(code: CrossDepErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

function revalidateCrossDepRoutes() {
  revalidatePath('/portfolio')
  revalidatePath('/portfolio/dependencies')
}

const dependencyTypeSchema = z.enum([
  'FINISH_TO_START',
  'START_TO_START',
  'FINISH_TO_FINISH',
  'START_TO_FINISH',
])

const createSchema = z.object({
  sourceTaskId: z.string().min(1),
  targetTaskId: z.string().min(1),
  type: dependencyTypeSchema,
  lagDays: z.number().int().optional(),
  notes: z.string().max(500).optional(),
  createdById: z.string().nullable().optional(),
})

const patchSchema = z.object({
  id: z.string().min(1),
  type: dependencyTypeSchema.optional(),
  lagDays: z.number().int().optional(),
  notes: z.string().max(500).nullable().optional(),
})

export interface CreateCrossDependencyInput {
  sourceTaskId: string
  targetTaskId: string
  type: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH'
  lagDays?: number
  notes?: string
  createdById?: string | null
}

export async function createCrossDependency(
  input: CreateCrossDependencyInput,
) {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)

  if (input.sourceTaskId === input.targetTaskId) {
    actionError('SELF_LOOP', 'Una tarea no puede depender de sí misma')
  }

  // Cargar las dos tareas y validar que pertenecen a proyectos distintos
  // (CrossProjectDependency es para programa, no intra-project).
  const [source, target] = await Promise.all([
    prisma.task.findUnique({
      where: { id: input.sourceTaskId },
      select: { id: true, title: true, projectId: true },
    }),
    prisma.task.findUnique({
      where: { id: input.targetTaskId },
      select: { id: true, title: true, projectId: true },
    }),
  ])
  if (!source) actionError('NOT_FOUND', 'sourceTask no existe')
  if (!target) actionError('NOT_FOUND', 'targetTask no existe')
  if (source.projectId === target.projectId) {
    actionError(
      'SAME_PROJECT',
      'Ambas tareas están en el mismo proyecto. Usa Dependency clásica.',
    )
  }

  // Detectar ciclo directo (B→A ya existe).
  const reverseExists = await prisma.crossProjectDependency.findFirst({
    where: {
      sourceTaskId: input.targetTaskId,
      targetTaskId: input.sourceTaskId,
    },
    select: { id: true },
  })
  if (reverseExists) {
    actionError(
      'DIRECT_CYCLE',
      'Ya existe la dependencia inversa. Esto crearía un ciclo directo.',
    )
  }

  // Duplicado exacto (unique constraint lo protege, pero damos mejor mensaje).
  const dupe = await prisma.crossProjectDependency.findFirst({
    where: {
      sourceTaskId: input.sourceTaskId,
      targetTaskId: input.targetTaskId,
    },
    select: { id: true },
  })
  if (dupe) actionError('DUPLICATE', 'Esta dependencia ya está registrada.')

  const created = await prisma.crossProjectDependency.create({
    data: {
      sourceTaskId: input.sourceTaskId,
      targetTaskId: input.targetTaskId,
      type: input.type,
      lagDays: input.lagDays ?? 0,
      notes: input.notes ?? null,
      createdById: input.createdById ?? null,
    },
  })

  await recordAuditEventSafe({
    action: 'cross_dependency.created',
    entityType: 'cross_dependency',
    entityId: created.id,
    after: {
      sourceTaskId: created.sourceTaskId,
      targetTaskId: created.targetTaskId,
      type: created.type,
      lagDays: created.lagDays,
      sourceProjectId: source.projectId,
      targetProjectId: target.projectId,
    },
  })

  revalidateCrossDepRoutes()
  return created
}

export interface UpdateCrossDependencyInput {
  id: string
  type?: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH'
  lagDays?: number
  notes?: string | null
}

export async function updateCrossDependency(input: UpdateCrossDependencyInput) {
  const parsed = patchSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)

  const before = await prisma.crossProjectDependency.findUnique({
    where: { id: input.id },
  })
  if (!before) actionError('NOT_FOUND', 'dependencia no existe')

  const updated = await prisma.crossProjectDependency.update({
    where: { id: input.id },
    data: {
      type: input.type ?? before.type,
      lagDays: input.lagDays ?? before.lagDays,
      notes: input.notes === undefined ? before.notes : input.notes,
    },
  })

  await recordAuditEventSafe({
    action: 'cross_dependency.updated',
    entityType: 'cross_dependency',
    entityId: updated.id,
    before: {
      type: before.type,
      lagDays: before.lagDays,
      notes: before.notes,
    },
    after: {
      type: updated.type,
      lagDays: updated.lagDays,
      notes: updated.notes,
    },
  })

  revalidateCrossDepRoutes()
  return updated
}

export async function deleteCrossDependency(id: string) {
  if (!id) actionError('INVALID_INPUT', 'id requerido')

  const before = await prisma.crossProjectDependency.findUnique({
    where: { id },
  })
  if (!before) actionError('NOT_FOUND', 'dependencia no existe')

  await prisma.crossProjectDependency.delete({ where: { id } })

  await recordAuditEventSafe({
    action: 'cross_dependency.removed',
    entityType: 'cross_dependency',
    entityId: id,
    before: {
      sourceTaskId: before.sourceTaskId,
      targetTaskId: before.targetTaskId,
      type: before.type,
    },
  })

  revalidateCrossDepRoutes()
  return { ok: true as const }
}

/** Lista todas las CrossDeps del workspace con info de proyectos/tasks. */
export async function listAllCrossDependencies() {
  return prisma.crossProjectDependency.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      sourceTask: {
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { id: true, name: true } },
          endDate: true,
          status: true,
        },
      },
      targetTask: {
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { id: true, name: true } },
          endDate: true,
          status: true,
        },
      },
    },
  })
}

/** Lista CrossDeps que afectan a un proyecto (entrantes + salientes). */
export async function listCrossDependenciesForProject(projectId: string) {
  if (!projectId) actionError('INVALID_INPUT', 'projectId requerido')
  return prisma.crossProjectDependency.findMany({
    where: {
      OR: [
        { sourceTask: { projectId } },
        { targetTask: { projectId } },
      ],
    },
    include: {
      sourceTask: {
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { id: true, name: true } },
          endDate: true,
          status: true,
        },
      },
      targetTask: {
        select: {
          id: true,
          title: true,
          projectId: true,
          project: { select: { id: true, name: true } },
          endDate: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}
