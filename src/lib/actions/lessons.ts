'use server'

/**
 * Wave P12 (PMI 100%) — Lessons Learned repository.
 *
 * Wave P18 hardening — TODAS las queries pasan por
 * `withRlsContextFromSession()` para activar la RLS restrictiva
 * `LessonLearned_member_only` (solo miembros del proyecto pueden
 * leer/escribir filas).
 */

import { revalidatePath } from 'next/cache'
import type { LessonCategory, LessonVisibility } from '@prisma/client'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { withRlsContextFromSession } from '@/lib/db/with-rls-context'

function revalidateScopes(projectId?: string) {
  revalidatePath('/lessons-learned')
  if (projectId) {
    revalidatePath(`/projects/${projectId}`)
    revalidatePath(`/projects/${projectId}/lessons-learned`)
  }
}

export async function listLessons(input: {
  projectId?: string
  workspaceId?: string
  category?: LessonCategory
  search?: string
  limit?: number
}) {
  return withRlsContextFromSession((tx) =>
    tx.lessonLearned.findMany({
      where: {
        projectId: input.projectId,
        project: input.workspaceId
          ? { workspaceId: input.workspaceId }
          : undefined,
        category: input.category,
        OR: input.search
          ? [
              { title: { contains: input.search, mode: 'insensitive' } },
              { recommendation: { contains: input.search, mode: 'insensitive' } },
              { whatHappened: { contains: input.search, mode: 'insensitive' } },
              { appliesTo: { contains: input.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: {
        project: { select: { id: true, name: true } },
        capturedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit ?? 100,
    }),
  )
}

export async function getLesson(input: { id: string }) {
  return withRlsContextFromSession((tx) =>
    tx.lessonLearned.findUnique({
      where: { id: input.id },
      include: {
        project: { select: { id: true, name: true } },
        capturedBy: { select: { id: true, name: true } },
      },
    }),
  )
}

export async function createLesson(input: {
  projectId: string
  title: string
  category: LessonCategory
  context: string
  whatHappened: string
  rootCause?: string
  recommendation: string
  appliesTo?: string
  visibility?: LessonVisibility
  capturedById?: string
}) {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  if (!input.title?.trim()) throw new Error('[INVALID_INPUT] title requerido')
  if (!input.context?.trim()) throw new Error('[INVALID_INPUT] context requerido')
  if (!input.whatHappened?.trim())
    throw new Error('[INVALID_INPUT] whatHappened requerido')
  if (!input.recommendation?.trim())
    throw new Error('[INVALID_INPUT] recommendation requerido')

  const created = await withRlsContextFromSession((tx) =>
    tx.lessonLearned.create({
      data: {
        projectId: input.projectId,
        title: input.title.trim(),
        category: input.category,
        context: input.context.trim(),
        whatHappened: input.whatHappened.trim(),
        rootCause: input.rootCause?.trim() || null,
        recommendation: input.recommendation.trim(),
        appliesTo: input.appliesTo?.trim() || null,
        visibility: input.visibility ?? 'WORKSPACE',
        capturedById: input.capturedById || null,
      },
    }),
  )

  await recordAuditEventSafe({
    action: 'lesson.created',
    entityType: 'lesson',
    entityId: created.id,
    actorId: input.capturedById,
    after: { title: created.title, category: created.category },
  })

  revalidateScopes(input.projectId)
  return created
}

export async function updateLesson(input: {
  id: string
  title?: string
  category?: LessonCategory
  context?: string
  whatHappened?: string
  rootCause?: string | null
  recommendation?: string
  appliesTo?: string | null
  visibility?: LessonVisibility
  actorId?: string
}) {
  const result = await withRlsContextFromSession(async (tx) => {
    const before = await tx.lessonLearned.findUnique({
      where: { id: input.id },
    })
    if (!before) throw new Error('[NOT_FOUND] lesson no existe')

    const updated = await tx.lessonLearned.update({
      where: { id: input.id },
      data: {
        title: input.title?.trim() ?? before.title,
        category: input.category ?? before.category,
        context: input.context?.trim() ?? before.context,
        whatHappened: input.whatHappened?.trim() ?? before.whatHappened,
        rootCause:
          input.rootCause === undefined
            ? before.rootCause
            : input.rootCause?.trim() || null,
        recommendation: input.recommendation?.trim() ?? before.recommendation,
        appliesTo:
          input.appliesTo === undefined
            ? before.appliesTo
            : input.appliesTo?.trim() || null,
        visibility: input.visibility ?? before.visibility,
      },
    })
    return { before, updated }
  })

  await recordAuditEventSafe({
    action: 'lesson.updated',
    entityType: 'lesson',
    entityId: input.id,
    actorId: input.actorId,
  })

  revalidateScopes(result.before.projectId)
  return result.updated
}

export async function deleteLesson(input: { id: string; actorId?: string }) {
  const before = await withRlsContextFromSession(async (tx) => {
    const row = await tx.lessonLearned.findUnique({
      where: { id: input.id },
      select: { id: true, projectId: true, title: true },
    })
    if (!row) return null
    await tx.lessonLearned.delete({ where: { id: input.id } })
    return row
  })
  if (!before) return { ok: true }

  await recordAuditEventSafe({
    action: 'lesson.deleted',
    entityType: 'lesson',
    entityId: input.id,
    actorId: input.actorId,
    before: { title: before.title },
  })

  revalidateScopes(before.projectId)
  return { ok: true }
}

export async function getLessonCategoryStats(input: {
  workspaceId?: string
  projectId?: string
}) {
  // P17-A · N+1/sobre-fetch fix: usábamos findMany para traer todas las
  // filas y contarlas en TS. Ahora dejamos a Postgres agregar y solo
  // viajamos los rollups (1 fila por categoría). La query crítica usa
  // los índices @@index([projectId]) y la FK Project.workspaceId.
  const grouped = await withRlsContextFromSession((tx) =>
    tx.lessonLearned.groupBy({
      by: ['category'],
      where: {
        projectId: input.projectId,
        project: input.workspaceId
          ? { workspaceId: input.workspaceId }
          : undefined,
      },
      _count: { _all: true },
    }),
  )
  const stats: Record<string, number> = {}
  let total = 0
  for (const g of grouped) {
    stats[g.category] = g._count._all
    total += g._count._all
  }
  return { total, byCategory: stats }
}
