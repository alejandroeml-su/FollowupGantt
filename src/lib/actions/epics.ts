'use server'

/**
 * Wave P9 · Agile Maturity (HU-9.1, HU-9.2)
 *
 * Server actions para CRUD de Epic — contenedor temático que agrupa
 * Stories/Tasks bajo iniciativas reconocibles. Ortogonal a Phase y Sprint.
 *
 * Patrón:
 *   - Errores tipados `[CODE] mensaje` (parseable por client).
 *   - `revalidatePath` de las vistas afectadas (lista, kanban, tabla, gantt,
 *     project detail) tras cualquier mutación.
 *   - Validación de color hex en server (defensa-en-profundidad — el UI
 *     ya valida, pero no confiamos sólo del cliente).
 *   - `archivedAt` en lugar de DELETE: borrar un Epic NO debe perder data
 *     histórica. La query de listado filtra `archivedAt IS NULL`.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import type { EpicStatus } from '@prisma/client'

const COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/

const VALID_STATUSES: readonly EpicStatus[] = [
  'PLANNED',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED',
] as const

function assertValidColor(color: string): void {
  if (!COLOR_HEX_REGEX.test(color)) {
    throw new Error(
      `[INVALID_COLOR] color debe ser hex de 6 dígitos (ej. #818cf8), recibido: ${color}`,
    )
  }
}

function assertValidStatus(status: string): asserts status is EpicStatus {
  if (!VALID_STATUSES.includes(status as EpicStatus)) {
    throw new Error(
      `[INVALID_STATUS] status inválido: ${status}. Esperado: ${VALID_STATUSES.join(' | ')}`,
    )
  }
}

function revalidateEpicViews(): void {
  for (const p of ['/list', '/kanban', '/gantt', '/table', '/projects'] as const) {
    revalidatePath(p)
  }
}

export type CreateEpicInput = {
  name: string
  description?: string | null
  color?: string
  projectId: string
  ownerId?: string | null
  plannedStartDate?: string | null
  plannedEndDate?: string | null
  /** Wave P9 follow-up — regla ágil "Épicas se asignan a un Release". */
  releaseId?: string | null
}

export async function createEpic(input: CreateEpicInput) {
  if (!input.name?.trim()) {
    throw new Error('[INVALID_INPUT] name requerido')
  }
  if (!input.projectId) {
    throw new Error('[INVALID_INPUT] projectId requerido')
  }
  const color = input.color ?? '#818cf8'
  assertValidColor(color)

  // Calcular position siguiente (último + 1) — orden estable.
  const lastEpic = await prisma.epic.findFirst({
    where: { projectId: input.projectId, archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const position = (lastEpic?.position ?? 0) + 1

  const epic = await prisma.epic.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      color,
      projectId: input.projectId,
      ownerId: input.ownerId || null,
      position,
      plannedStartDate: input.plannedStartDate ? new Date(input.plannedStartDate) : null,
      plannedEndDate: input.plannedEndDate ? new Date(input.plannedEndDate) : null,
    },
  })

  // Asociación a Release (M2M ReleaseEpic) si se solicitó.
  // La Release debe pertenecer al mismo proyecto y tener scopeMode=EPIC.
  // Si falla la validación, se omite silenciosamente para no bloquear la
  // creación de la Epic (regla ágil suave: la asociación es recomendada).
  if (input.releaseId) {
    try {
      const release = await prisma.release.findUnique({
        where: { id: input.releaseId },
        select: { projectId: true, scopeMode: true },
      })
      if (
        release &&
        release.projectId === input.projectId &&
        release.scopeMode === 'EPIC'
      ) {
        const last = await prisma.releaseEpic.findFirst({
          where: { releaseId: input.releaseId },
          orderBy: { position: 'desc' },
          select: { position: true },
        })
        await prisma.releaseEpic.create({
          data: {
            releaseId: input.releaseId,
            epicId: epic.id,
            position: (last?.position ?? -1) + 1,
          },
        })
      }
    } catch {
      // No bloqueamos la creación de la Epic por un fallo de asociación.
    }
  }

  await recordAuditEventSafe({
    action: 'epic.created',
    entityType: 'epic',
    entityId: epic.id,
    after: { name: epic.name, projectId: epic.projectId },
  })

  revalidateEpicViews()
  return epic
}

export type UpdateEpicInput = {
  id: string
  name?: string
  description?: string | null
  color?: string
  status?: string
  ownerId?: string | null
  plannedStartDate?: string | null
  plannedEndDate?: string | null
}

export async function updateEpic(input: UpdateEpicInput) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const before = await prisma.epic.findUnique({
    where: { id: input.id },
    select: { name: true, status: true, color: true },
  })
  if (!before) throw new Error('[NOT_FOUND] epic no existe')

  const data: Parameters<typeof prisma.epic.update>[0]['data'] = {}
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('[INVALID_INPUT] name no puede ser vacío')
    data.name = input.name.trim()
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null
  }
  if (input.color !== undefined) {
    assertValidColor(input.color)
    data.color = input.color
  }
  if (input.status !== undefined) {
    assertValidStatus(input.status)
    data.status = input.status
  }
  if (input.ownerId !== undefined) {
    data.ownerId = input.ownerId || null
  }
  if (input.plannedStartDate !== undefined) {
    data.plannedStartDate = input.plannedStartDate ? new Date(input.plannedStartDate) : null
  }
  if (input.plannedEndDate !== undefined) {
    data.plannedEndDate = input.plannedEndDate ? new Date(input.plannedEndDate) : null
  }

  const updated = await prisma.epic.update({ where: { id: input.id }, data })

  await recordAuditEventSafe({
    action: 'epic.updated',
    entityType: 'epic',
    entityId: input.id,
    before,
    after: { name: updated.name, status: updated.status, color: updated.color },
  })

  revalidateEpicViews()
  return updated
}

/**
 * Archivar (soft-delete). Las Tasks asociadas mantienen `epicId` pero
 * la Epic ya no aparece en listados ni filtros activos. Reversible con
 * `restoreEpic`.
 */
export async function archiveEpic(input: { id: string }) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const epic = await prisma.epic.update({
    where: { id: input.id },
    data: { archivedAt: new Date() },
  })

  await recordAuditEventSafe({
    action: 'epic.archived',
    entityType: 'epic',
    entityId: input.id,
  })

  revalidateEpicViews()
  return epic
}

export async function restoreEpic(input: { id: string }) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const epic = await prisma.epic.update({
    where: { id: input.id },
    data: { archivedAt: null },
  })

  await recordAuditEventSafe({
    action: 'epic.restored',
    entityType: 'epic',
    entityId: input.id,
  })

  revalidateEpicViews()
  return epic
}

/**
 * Asigna o desasigna una Task a una Epic. Valida que la Epic
 * pertenezca al mismo proyecto que la Task (defensa-en-profundidad).
 */
export async function assignTaskToEpic(input: {
  taskId: string
  epicId: string | null
}) {
  if (!input.taskId) throw new Error('[INVALID_INPUT] taskId requerido')

  if (input.epicId) {
    const [task, epic] = await Promise.all([
      prisma.task.findUnique({
        where: { id: input.taskId },
        select: { projectId: true },
      }),
      prisma.epic.findUnique({
        where: { id: input.epicId },
        select: { projectId: true },
      }),
    ])
    if (!task) throw new Error('[NOT_FOUND] task no existe')
    if (!epic) throw new Error('[NOT_FOUND] epic no existe')
    if (task.projectId !== epic.projectId) {
      throw new Error(
        '[INVALID_ASSIGNMENT] la Epic pertenece a otro proyecto que la Task',
      )
    }
  }

  await prisma.task.update({
    where: { id: input.taskId },
    data: { epicId: input.epicId },
  })

  await recordAuditEventSafe({
    action: input.epicId ? 'task.epic_assigned' : 'task.epic_unassigned',
    entityType: 'task',
    entityId: input.taskId,
    after: { epicId: input.epicId },
  })

  revalidateEpicViews()
  return { ok: true }
}

/**
 * Lista Epics de un proyecto (no archivadas), ordenados por position.
 * Incluye conteo de Tasks asociadas para mostrar en UI.
 */
export async function listEpicsForProject(projectId: string) {
  if (!projectId) return []
  return prisma.epic.findMany({
    where: { projectId, archivedAt: null },
    orderBy: { position: 'asc' },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { tasks: { where: { archivedAt: null } } } },
    },
  })
}
