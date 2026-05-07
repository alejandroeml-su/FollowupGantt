'use server'

/**
 * Wave P9 · Agile Maturity (HU-9.3) — Server actions para Historia de
 * Usuario formal y sus Criterios de Aceptación.
 *
 * El campo `Task.userStory` es Json en Prisma. Estas actions encapsulan
 * la mutación + validación de shape (con helpers puros de
 * `lib/user-story/types.ts`) + audit + revalidate.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  emptyUserStory,
  generateCriterionId,
  normalizeUserStory,
  type AcceptanceCriterion,
  type UserStory,
} from '@/lib/user-story/types'

function revalidateTaskViews() {
  for (const p of ['/list', '/kanban', '/gantt', '/table'] as const) {
    revalidatePath(p)
  }
}

async function loadStory(taskId: string): Promise<UserStory> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { userStory: true },
  })
  if (!task) throw new Error('[NOT_FOUND] task no existe')
  return normalizeUserStory(task.userStory) ?? emptyUserStory()
}

/**
 * Sobreescribe completamente la User Story de una task. Útil cuando el
 * usuario edita los 3 campos de texto (asA/iWant/soThat) en el form.
 * Los CAs se conservan tal cual vengan en el input — caller controla
 * el shape completo.
 */
export async function setUserStory(input: {
  taskId: string
  asA: string
  iWant: string
  soThat: string
  criteria?: AcceptanceCriterion[]
}) {
  if (!input.taskId) throw new Error('[INVALID_INPUT] taskId requerido')

  const story: UserStory = {
    asA: input.asA.trim(),
    iWant: input.iWant.trim(),
    soThat: input.soThat.trim(),
    criteria: Array.isArray(input.criteria) ? input.criteria : [],
  }

  await prisma.task.update({
    where: { id: input.taskId },
    data: { userStory: story },
  })

  await recordAuditEventSafe({
    action: 'task.user_story_updated',
    entityType: 'task',
    entityId: input.taskId,
    after: { hasStory: !!(story.asA || story.iWant || story.soThat), criteriaCount: story.criteria.length },
  })

  revalidateTaskViews()
  return story
}

/**
 * Agrega un criterio de aceptación nuevo (texto, done=false). Genera id
 * server-side para evitar colisiones si dos clientes mandan a la vez.
 */
export async function addAcceptanceCriterion(input: {
  taskId: string
  text: string
}) {
  if (!input.taskId) throw new Error('[INVALID_INPUT] taskId requerido')
  if (!input.text?.trim()) throw new Error('[INVALID_INPUT] text requerido')

  const story = await loadStory(input.taskId)
  const criterion: AcceptanceCriterion = {
    id: generateCriterionId(),
    text: input.text.trim(),
    done: false,
    doneAt: null,
  }
  story.criteria.push(criterion)

  await prisma.task.update({
    where: { id: input.taskId },
    data: { userStory: story },
  })

  await recordAuditEventSafe({
    action: 'task.acceptance_criterion_added',
    entityType: 'task',
    entityId: input.taskId,
    after: { criterionId: criterion.id, text: criterion.text },
  })

  revalidateTaskViews()
  return criterion
}

/**
 * Toggle del check de un CA. Si lo marcas done, registra `doneAt`.
 */
export async function toggleAcceptanceCriterion(input: {
  taskId: string
  criterionId: string
}) {
  if (!input.taskId) throw new Error('[INVALID_INPUT] taskId requerido')
  if (!input.criterionId) throw new Error('[INVALID_INPUT] criterionId requerido')

  const story = await loadStory(input.taskId)
  const idx = story.criteria.findIndex((c) => c.id === input.criterionId)
  if (idx < 0) throw new Error('[NOT_FOUND] criterio no encontrado')

  const c = story.criteria[idx]
  const nextDone = !c.done
  story.criteria[idx] = {
    ...c,
    done: nextDone,
    doneAt: nextDone ? new Date().toISOString() : null,
  }

  await prisma.task.update({
    where: { id: input.taskId },
    data: { userStory: story },
  })

  await recordAuditEventSafe({
    action: nextDone
      ? 'task.acceptance_criterion_done'
      : 'task.acceptance_criterion_undone',
    entityType: 'task',
    entityId: input.taskId,
    after: { criterionId: c.id },
  })

  revalidateTaskViews()
  return story.criteria[idx]
}

/**
 * Borra un CA. Operación destructiva intencional — el caller (UI) debe
 * confirmar. No registramos `before` con todos los CAs porque el
 * audit-log lo haría pesado; sólo `text` para diagnóstico.
 */
export async function removeAcceptanceCriterion(input: {
  taskId: string
  criterionId: string
}) {
  if (!input.taskId) throw new Error('[INVALID_INPUT] taskId requerido')
  if (!input.criterionId) throw new Error('[INVALID_INPUT] criterionId requerido')

  const story = await loadStory(input.taskId)
  const removed = story.criteria.find((c) => c.id === input.criterionId)
  if (!removed) throw new Error('[NOT_FOUND] criterio no encontrado')

  story.criteria = story.criteria.filter((c) => c.id !== input.criterionId)

  await prisma.task.update({
    where: { id: input.taskId },
    data: { userStory: story },
  })

  await recordAuditEventSafe({
    action: 'task.acceptance_criterion_removed',
    entityType: 'task',
    entityId: input.taskId,
    after: { criterionId: removed.id, text: removed.text },
  })

  revalidateTaskViews()
  return { ok: true }
}

/**
 * Edita el texto de un CA existente (sin tocar `done`/`doneAt`).
 */
export async function updateAcceptanceCriterion(input: {
  taskId: string
  criterionId: string
  text: string
}) {
  if (!input.taskId) throw new Error('[INVALID_INPUT] taskId requerido')
  if (!input.criterionId) throw new Error('[INVALID_INPUT] criterionId requerido')
  if (!input.text?.trim()) throw new Error('[INVALID_INPUT] text requerido')

  const story = await loadStory(input.taskId)
  const idx = story.criteria.findIndex((c) => c.id === input.criterionId)
  if (idx < 0) throw new Error('[NOT_FOUND] criterio no encontrado')

  story.criteria[idx] = { ...story.criteria[idx], text: input.text.trim() }

  await prisma.task.update({
    where: { id: input.taskId },
    data: { userStory: story },
  })

  revalidateTaskViews()
  return story.criteria[idx]
}
