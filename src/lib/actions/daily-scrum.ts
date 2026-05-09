'use server'

/**
 * Wave P12 (Scrum 100%) — Server actions Daily Scrum.
 */

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'

export interface DailyScrumEntry {
  userId: string
  did: string
  willDo: string
  blockers: string
}

export interface DailyScrumData {
  entries: DailyScrumEntry[]
}

function normalizeData(raw: unknown): DailyScrumData {
  if (!raw || typeof raw !== 'object') return { entries: [] }
  const r = raw as Record<string, unknown>
  const entries = Array.isArray(r.entries)
    ? r.entries
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map(
          (e): DailyScrumEntry => ({
            userId: typeof e.userId === 'string' ? e.userId : '',
            did: typeof e.did === 'string' ? e.did : '',
            willDo: typeof e.willDo === 'string' ? e.willDo : '',
            blockers: typeof e.blockers === 'string' ? e.blockers : '',
          }),
        )
        .filter((e) => e.userId.length > 0)
    : []
  return { entries }
}

function revalidateScopes(projectId: string, sprintId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/sprints/${sprintId}`)
  revalidatePath(`/projects/${projectId}/daily-scrum`)
  revalidatePath('/scrum/daily')
}

export async function listDailyScrums(input: { sprintId: string; limit?: number }) {
  if (!input.sprintId) throw new Error('[INVALID_INPUT] sprintId requerido')
  return prisma.dailyScrum.findMany({
    where: { sprintId: input.sprintId },
    include: {
      facilitator: { select: { id: true, name: true } },
      sprint: { select: { id: true, name: true, projectId: true } },
    },
    orderBy: { scheduledFor: 'desc' },
    take: input.limit ?? 30,
  })
}

export async function getDailyScrum(input: { id: string }) {
  return prisma.dailyScrum.findUnique({
    where: { id: input.id },
    include: {
      facilitator: { select: { id: true, name: true } },
      sprint: { select: { id: true, name: true, projectId: true } },
    },
  })
}

export async function createDailyScrum(input: {
  sprintId: string
  facilitatorId?: string
  scheduledFor?: string
  data?: DailyScrumData
  notes?: string
}) {
  if (!input.sprintId) throw new Error('[INVALID_INPUT] sprintId requerido')
  const sprint = await prisma.sprint.findUnique({
    where: { id: input.sprintId },
    select: { projectId: true },
  })
  if (!sprint) throw new Error('[NOT_FOUND] sprint no existe')

  const data = normalizeData(input.data ?? { entries: [] })
  const created = await prisma.dailyScrum.create({
    data: {
      sprintId: input.sprintId,
      facilitatorId: input.facilitatorId || null,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : new Date(),
      data: data as unknown as Prisma.InputJsonValue,
      notes: input.notes?.trim() || null,
    },
  })

  await recordAuditEventSafe({
    action: 'daily_scrum.created',
    entityType: 'daily_scrum',
    entityId: created.id,
    actorId: input.facilitatorId,
    after: { entries: data.entries.length },
  })

  revalidateScopes(sprint.projectId, input.sprintId)
  return created
}

export async function updateDailyScrum(input: {
  id: string
  data?: DailyScrumData
  notes?: string
  actorId?: string
}) {
  const before = await prisma.dailyScrum.findUnique({
    where: { id: input.id },
    include: { sprint: { select: { projectId: true, id: true } } },
  })
  if (!before) throw new Error('[NOT_FOUND] daily scrum no existe')

  const data = input.data ? normalizeData(input.data) : null
  const updated = await prisma.dailyScrum.update({
    where: { id: input.id },
    data: {
      data: data
        ? (data as unknown as Prisma.InputJsonValue)
        : (before.data as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      notes: input.notes !== undefined ? input.notes.trim() || null : before.notes,
    },
  })

  await recordAuditEventSafe({
    action: 'daily_scrum.updated',
    entityType: 'daily_scrum',
    entityId: input.id,
    actorId: input.actorId,
  })

  revalidateScopes(before.sprint.projectId, before.sprint.id)
  return updated
}

export async function deleteDailyScrum(input: { id: string }) {
  const before = await prisma.dailyScrum.findUnique({
    where: { id: input.id },
    include: { sprint: { select: { projectId: true, id: true } } },
  })
  if (!before) return { ok: true }
  await prisma.dailyScrum.delete({ where: { id: input.id } })
  revalidateScopes(before.sprint.projectId, before.sprint.id)
  return { ok: true }
}
