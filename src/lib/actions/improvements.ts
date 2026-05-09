'use server'

/**
 * Wave P12 (Scrum 100%) — Improvement Items (Retro Action Items
 * con tracking cross-sprint).
 */

import { revalidatePath } from 'next/cache'
import type { ImprovementStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'

function revalidateScopes(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/improvements`)
  revalidatePath(`/projects/${projectId}/retrospectives`)
  revalidatePath('/scrum/improvements')
}

export async function listImprovements(input: {
  projectId: string
  status?: ImprovementStatus
}) {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  return prisma.improvementItem.findMany({
    where: {
      projectId: input.projectId,
      status: input.status,
    },
    include: {
      owner: { select: { id: true, name: true } },
      retrospective: {
        select: {
          id: true,
          title: true,
          sprint: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  })
}

export async function createImprovement(input: {
  projectId: string
  title: string
  description?: string
  ownerId?: string | null
  retrospectiveId?: string | null
  dueDate?: string | null
  actorId?: string
}) {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  if (!input.title?.trim()) throw new Error('[INVALID_INPUT] title requerido')

  const created = await prisma.improvementItem.create({
    data: {
      projectId: input.projectId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      ownerId: input.ownerId || null,
      retrospectiveId: input.retrospectiveId || null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      status: 'OPEN',
    },
  })

  await recordAuditEventSafe({
    action: 'improvement.created',
    entityType: 'improvement',
    entityId: created.id,
    actorId: input.actorId,
    after: { title: created.title },
  })

  revalidateScopes(input.projectId)
  return created
}

export async function updateImprovementStatus(input: {
  id: string
  status: ImprovementStatus
  closeNotes?: string
  actorId?: string
}) {
  const before = await prisma.improvementItem.findUnique({
    where: { id: input.id },
  })
  if (!before) throw new Error('[NOT_FOUND] improvement no existe')

  const isClosing = input.status === 'DONE' || input.status === 'CANCELLED'
  const updated = await prisma.improvementItem.update({
    where: { id: input.id },
    data: {
      status: input.status,
      closeNotes: input.closeNotes?.trim() || before.closeNotes,
      closedAt: isClosing ? new Date() : null,
    },
  })

  const action =
    input.status === 'DONE' ? 'improvement.completed' : 'improvement.updated'

  await recordAuditEventSafe({
    action,
    entityType: 'improvement',
    entityId: input.id,
    actorId: input.actorId,
    before: { status: before.status },
    after: { status: updated.status },
  })

  revalidateScopes(before.projectId)
  return updated
}

export async function updateImprovement(input: {
  id: string
  title?: string
  description?: string
  ownerId?: string | null
  dueDate?: string | null
  actorId?: string
}) {
  const before = await prisma.improvementItem.findUnique({
    where: { id: input.id },
  })
  if (!before) throw new Error('[NOT_FOUND] improvement no existe')

  const updated = await prisma.improvementItem.update({
    where: { id: input.id },
    data: {
      title: input.title?.trim() ?? before.title,
      description: input.description?.trim() ?? before.description,
      ownerId: input.ownerId === undefined ? before.ownerId : input.ownerId,
      dueDate:
        input.dueDate === undefined
          ? before.dueDate
          : input.dueDate === null
            ? null
            : new Date(input.dueDate),
    },
  })

  await recordAuditEventSafe({
    action: 'improvement.updated',
    entityType: 'improvement',
    entityId: input.id,
    actorId: input.actorId,
  })

  revalidateScopes(before.projectId)
  return updated
}

export async function deleteImprovement(input: { id: string; actorId?: string }) {
  const before = await prisma.improvementItem.findUnique({
    where: { id: input.id },
  })
  if (!before) return { ok: true }
  await prisma.improvementItem.delete({ where: { id: input.id } })
  revalidateScopes(before.projectId)
  return { ok: true }
}

export async function getImprovementMetrics(input: { projectId: string }) {
  const items = await prisma.improvementItem.findMany({
    where: { projectId: input.projectId },
    select: { status: true, createdAt: true, closedAt: true, dueDate: true },
  })
  const total = items.length
  const open = items.filter((i) => i.status === 'OPEN').length
  const inProgress = items.filter((i) => i.status === 'IN_PROGRESS').length
  const done = items.filter((i) => i.status === 'DONE').length
  const cancelled = items.filter((i) => i.status === 'CANCELLED').length
  const overdue = items.filter(
    (i) =>
      i.status !== 'DONE' &&
      i.status !== 'CANCELLED' &&
      i.dueDate &&
      i.dueDate < new Date(),
  ).length
  const closeRate = total > 0 ? Math.round((done / total) * 100) : 0
  return { total, open, inProgress, done, cancelled, overdue, closeRate }
}
