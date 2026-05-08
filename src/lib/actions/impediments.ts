'use server'

/**
 * Wave P12 (Scrum 100%) — Server actions Impediments tracker.
 */

import { revalidatePath } from 'next/cache'
import type { ImpedimentSeverity, ImpedimentStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'

function revalidateScopes(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/impediments`)
  revalidatePath(`/projects/${projectId}/sprints`)
  revalidatePath('/scrum/impediments')
}

export async function listImpediments(input: {
  projectId?: string
  sprintId?: string
}) {
  if (!input.projectId && !input.sprintId) {
    throw new Error('[INVALID_INPUT] projectId o sprintId requerido')
  }
  return prisma.impediment.findMany({
    where: {
      sprintId: input.sprintId,
      sprint: input.projectId ? { projectId: input.projectId } : undefined,
    },
    include: {
      raisedBy: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      sprint: { select: { id: true, name: true, projectId: true } },
    },
    orderBy: [{ status: 'asc' }, { severity: 'desc' }, { raisedAt: 'desc' }],
  })
}

export async function createImpediment(input: {
  sprintId: string
  title: string
  description?: string
  severity?: ImpedimentSeverity
  raisedById?: string
  ownerId?: string | null
}) {
  if (!input.sprintId) throw new Error('[INVALID_INPUT] sprintId requerido')
  if (!input.title?.trim()) throw new Error('[INVALID_INPUT] title requerido')

  const sprint = await prisma.sprint.findUnique({
    where: { id: input.sprintId },
    select: { projectId: true },
  })
  if (!sprint) throw new Error('[NOT_FOUND] sprint no existe')

  const created = await prisma.impediment.create({
    data: {
      sprintId: input.sprintId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      severity: input.severity ?? 'MEDIUM',
      status: 'OPEN',
      raisedById: input.raisedById || null,
      ownerId: input.ownerId || null,
    },
  })

  await recordAuditEventSafe({
    action: 'impediment.created',
    entityType: 'impediment',
    entityId: created.id,
    actorId: input.raisedById,
    after: { title: created.title, severity: created.severity },
  })

  revalidateScopes(sprint.projectId)
  return created
}

export async function updateImpedimentStatus(input: {
  id: string
  status: ImpedimentStatus
  resolutionNotes?: string
  actorId?: string
}) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const before = await prisma.impediment.findUnique({
    where: { id: input.id },
    include: { sprint: { select: { projectId: true } } },
  })
  if (!before) throw new Error('[NOT_FOUND] impediment no existe')

  const isResolving = input.status === 'RESOLVED'
  const updated = await prisma.impediment.update({
    where: { id: input.id },
    data: {
      status: input.status,
      resolutionNotes: input.resolutionNotes?.trim() || before.resolutionNotes,
      resolvedAt: isResolving ? new Date() : before.resolvedAt,
    },
  })

  const action =
    input.status === 'RESOLVED'
      ? 'impediment.resolved'
      : input.status === 'ESCALATED'
        ? 'impediment.escalated'
        : 'impediment.updated'

  await recordAuditEventSafe({
    action,
    entityType: 'impediment',
    entityId: input.id,
    actorId: input.actorId,
    before: { status: before.status },
    after: { status: updated.status },
  })

  revalidateScopes(before.sprint.projectId)
  return updated
}

export async function updateImpediment(input: {
  id: string
  title?: string
  description?: string
  severity?: ImpedimentSeverity
  ownerId?: string | null
  actorId?: string
}) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const before = await prisma.impediment.findUnique({
    where: { id: input.id },
    include: { sprint: { select: { projectId: true } } },
  })
  if (!before) throw new Error('[NOT_FOUND] impediment no existe')

  const updated = await prisma.impediment.update({
    where: { id: input.id },
    data: {
      title: input.title?.trim() ?? before.title,
      description: input.description?.trim() ?? before.description,
      severity: input.severity ?? before.severity,
      ownerId: input.ownerId === undefined ? before.ownerId : input.ownerId,
    },
  })

  await recordAuditEventSafe({
    action: 'impediment.updated',
    entityType: 'impediment',
    entityId: input.id,
    actorId: input.actorId,
  })

  revalidateScopes(before.sprint.projectId)
  return updated
}

export async function deleteImpediment(input: { id: string; actorId?: string }) {
  const before = await prisma.impediment.findUnique({
    where: { id: input.id },
    include: { sprint: { select: { projectId: true } } },
  })
  if (!before) return { ok: true }
  await prisma.impediment.delete({ where: { id: input.id } })

  await recordAuditEventSafe({
    action: 'impediment.updated',
    entityType: 'impediment',
    entityId: input.id,
    actorId: input.actorId,
    metadata: { op: 'deleted' },
  })

  revalidateScopes(before.sprint.projectId)
  return { ok: true }
}
