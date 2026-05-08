'use server'

/**
 * Wave P11-Scrum (HU-11.2) — Server actions Sprint Review.
 *
 * El Sprint Review es el evento donde el Scrum Team presenta el
 * increment a stakeholders y recoge feedback. Antes de Wave P11 no
 * había vista dedicada — el sprint cerraba sin ritual de review.
 *
 * Estos actions exponen:
 *   - `getSprintReviewData(sprintId)` — datos para la vista
 *   - `markSprintReviewed(sprintId, notes?, demoUrl?)` — cierra el
 *     evento y persiste feedback
 *   - `setSprintDemoUrl(sprintId, url)` — link de demo grabado
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'

export interface SprintReviewSnapshot {
  sprint: {
    id: string
    name: string
    goal: string | null
    startDate: string
    endDate: string
    capacity: number | null
    velocityActual: number | null
    reviewedAt: string | null
    reviewNotes: string | null
    demoUrl: string | null
  }
  project: {
    id: string
    name: string
  }
  /** Tasks DONE del sprint (el Increment entregable). */
  completedTasks: Array<{
    id: string
    mnemonic: string | null
    title: string
    storyPoints: number | null
    type: string
    assignee: { id: string; name: string } | null
  }>
  /** Tasks NO done (carry-over al próximo sprint o al backlog). */
  carryOverTasks: Array<{
    id: string
    mnemonic: string | null
    title: string
    status: string
    storyPoints: number | null
    assignee: { id: string; name: string } | null
  }>
  totals: {
    totalTasks: number
    doneTasks: number
    carryOverTasks: number
    spDelivered: number
    spCarriedOver: number
    completionPercent: number
  }
}

export async function getSprintReviewData(
  sprintId: string,
): Promise<SprintReviewSnapshot> {
  if (!sprintId) throw new Error('[INVALID_INPUT] sprintId requerido')

  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: {
      id: true,
      name: true,
      goal: true,
      startDate: true,
      endDate: true,
      capacity: true,
      velocityActual: true,
      reviewedAt: true,
      reviewNotes: true,
      demoUrl: true,
      project: { select: { id: true, name: true } },
      tasks: {
        where: { archivedAt: null, parentId: null },
        select: {
          id: true,
          mnemonic: true,
          title: true,
          status: true,
          type: true,
          storyPoints: true,
          assignee: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { priority: 'asc' }],
      },
    },
  })
  if (!sprint) throw new Error('[NOT_FOUND] sprint no existe')

  const done = sprint.tasks.filter((t) => t.status === 'DONE')
  const carry = sprint.tasks.filter((t) => t.status !== 'DONE')

  const spDelivered = done.reduce((s, t) => s + (t.storyPoints ?? 0), 0)
  const spCarriedOver = carry.reduce((s, t) => s + (t.storyPoints ?? 0), 0)
  const totalTasks = sprint.tasks.length
  const completionPercent =
    totalTasks === 0 ? 0 : Math.round((done.length / totalTasks) * 100)

  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate.toISOString(),
      endDate: sprint.endDate.toISOString(),
      capacity: sprint.capacity,
      velocityActual: sprint.velocityActual,
      reviewedAt: sprint.reviewedAt?.toISOString() ?? null,
      reviewNotes: sprint.reviewNotes,
      demoUrl: sprint.demoUrl,
    },
    project: sprint.project,
    completedTasks: done.map((t) => ({
      id: t.id,
      mnemonic: t.mnemonic,
      title: t.title,
      storyPoints: t.storyPoints,
      type: t.type,
      assignee: t.assignee,
    })),
    carryOverTasks: carry.map((t) => ({
      id: t.id,
      mnemonic: t.mnemonic,
      title: t.title,
      status: t.status,
      storyPoints: t.storyPoints,
      assignee: t.assignee,
    })),
    totals: {
      totalTasks,
      doneTasks: done.length,
      carryOverTasks: carry.length,
      spDelivered,
      spCarriedOver,
      completionPercent,
    },
  }
}

export async function markSprintReviewed(input: {
  sprintId: string
  reviewNotes?: string
  demoUrl?: string | null
}): Promise<{ ok: true; reviewedAt: string }> {
  if (!input.sprintId) throw new Error('[INVALID_INPUT] sprintId requerido')

  const before = await prisma.sprint.findUnique({
    where: { id: input.sprintId },
    select: { reviewedAt: true, reviewNotes: true, demoUrl: true, projectId: true },
  })
  if (!before) throw new Error('[NOT_FOUND] sprint no existe')

  const reviewedAt = new Date()
  await prisma.sprint.update({
    where: { id: input.sprintId },
    data: {
      reviewedAt,
      reviewNotes: input.reviewNotes ?? before.reviewNotes,
      demoUrl: input.demoUrl ?? before.demoUrl,
    },
  })

  await recordAuditEventSafe({
    action: 'sprint.reviewed',
    entityType: 'sprint',
    entityId: input.sprintId,
    before: {
      reviewedAt: before.reviewedAt?.toISOString() ?? null,
      demoUrl: before.demoUrl,
    },
    after: {
      reviewedAt: reviewedAt.toISOString(),
      demoUrl: input.demoUrl ?? before.demoUrl,
    },
  })

  revalidatePath(`/projects/${before.projectId}`)
  revalidatePath(`/projects/${before.projectId}/sprints/${input.sprintId}/review`)
  return { ok: true, reviewedAt: reviewedAt.toISOString() }
}
