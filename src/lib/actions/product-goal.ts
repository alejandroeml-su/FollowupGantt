'use server'

/**
 * Wave P11-Scrum (HU-11.1) — Server actions Product Goal.
 *
 * Persiste en `Project.productGoal` (Json). Validación tipada vía
 * `normalizeProductGoal`. Audit `project.product_goal_updated` por
 * cada mutación para trazabilidad del PO.
 */

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  normalizeProductGoal,
  type ProductGoal,
} from '@/lib/product-goal/types'

function revalidateProductGoalViews(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/product-goal`)
  revalidatePath(`/projects/${projectId}/backlog`)
}

export async function getProductGoal(projectId: string): Promise<ProductGoal> {
  if (!projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { productGoal: true },
  })
  if (!project) throw new Error('[NOT_FOUND] proyecto no existe')
  return normalizeProductGoal(project.productGoal)
}

export async function setProductGoal(input: {
  projectId: string
  statement: string
  successMetrics: string[]
  targetDate: string | null
}): Promise<ProductGoal> {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')
  if (!input.statement?.trim()) {
    throw new Error('[INVALID_INPUT] statement requerido')
  }

  const before = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { productGoal: true },
  })
  if (!before) throw new Error('[NOT_FOUND] proyecto no existe')

  const next: ProductGoal = {
    statement: input.statement.trim().slice(0, 280),
    successMetrics: input.successMetrics
      .map((m) => m.trim())
      .filter((m) => m.length > 0)
      .slice(0, 10),
    targetDate: input.targetDate || null,
    lastReviewedAt: new Date().toISOString(),
  }

  await prisma.project.update({
    where: { id: input.projectId },
    data: { productGoal: next as unknown as Prisma.InputJsonValue },
  })

  await recordAuditEventSafe({
    action: 'project.product_goal_updated',
    entityType: 'project',
    entityId: input.projectId,
    before: { productGoal: before.productGoal },
    after: { productGoal: next },
  })

  revalidateProductGoalViews(input.projectId)
  return next
}

/** Marca el goal como recién revisado por el PO sin cambiar contenido. */
export async function touchProductGoalReview(
  projectId: string,
): Promise<ProductGoal> {
  const current = await getProductGoal(projectId)
  if (!current.statement) {
    throw new Error('[INVALID_INPUT] no hay Product Goal definido aún')
  }
  const next = { ...current, lastReviewedAt: new Date().toISOString() }
  await prisma.project.update({
    where: { id: projectId },
    data: { productGoal: next },
  })
  await recordAuditEventSafe({
    action: 'project.product_goal_updated',
    entityType: 'project',
    entityId: projectId,
    after: { productGoal: next },
  })
  revalidateProductGoalViews(projectId)
  return next
}
