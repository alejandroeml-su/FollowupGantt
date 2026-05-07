'use server'

/**
 * Wave P9 R2 (HU-9.9) — Server actions para Sprint Retrospective.
 *
 * Operaciones:
 *   - createRetrospective    crear retro vinculada a un sprint.
 *   - addRetroItem           agregar item a una columna (categoría).
 *   - updateRetroItemText    editar texto de item.
 *   - removeRetroItem        eliminar item.
 *   - toggleRetroItemVote    toggle vote del user actual.
 *   - convertItemToTask      genera Task desde item (action item) y
 *                            persiste el taskId en el item.
 *   - completeRetrospective  marca completedAt → readonly.
 *
 * Patrón: leer data, normalizar shape, mutar, persistir. Audit + revalidate.
 *
 * No usamos transacciones por mutación en data (no hay race conditions
 * relevantes; última-escritura-gana es aceptable para retros).
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  emptyData,
  generateItemId,
  isValidFormat,
  normalizeData,
  type RetroItem,
  type RetrospectiveData,
  type RetrospectiveFormat,
} from '@/lib/retrospective/types'

function revalidateRetro(retroId: string, sprintId?: string) {
  if (sprintId) {
    revalidatePath(`/projects`)
    // No conocemos el projectId aquí sin round-trip; el caller lo
    // sabe. Para seguridad revalidamos las vistas de tareas también
    // por si el retro creó action items.
  }
  revalidatePath(`/list`)
  revalidatePath(`/kanban`)
  void retroId
}

async function loadRetroOrThrow(id: string) {
  const retro = await prisma.retrospective.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      format: true,
      data: true,
      completedAt: true,
      sprintId: true,
      sprint: { select: { projectId: true } },
    },
  })
  if (!retro) throw new Error('[NOT_FOUND] retrospectiva no existe')
  if (retro.completedAt) {
    throw new Error('[RETRO_COMPLETED] la retrospectiva está cerrada y no admite más cambios')
  }
  return retro
}

async function persistData(retroId: string, data: RetrospectiveData) {
  await prisma.retrospective.update({
    where: { id: retroId },
    data: { data: data as unknown as Parameters<typeof prisma.retrospective.update>[0]['data']['data'] },
  })
}

// ─── CRUD principal ──────────────────────────────────────────────

export async function createRetrospective(input: {
  title: string
  sprintId: string
  format?: RetrospectiveFormat
  notes?: string | null
  facilitatorId?: string | null
}) {
  if (!input.title?.trim()) throw new Error('[INVALID_INPUT] title requerido')
  if (!input.sprintId) throw new Error('[INVALID_INPUT] sprintId requerido')

  const format: RetrospectiveFormat = isValidFormat(input.format)
    ? input.format
    : 'FOUR_LS'

  const sprint = await prisma.sprint.findUnique({
    where: { id: input.sprintId },
    select: { projectId: true },
  })
  if (!sprint) throw new Error('[NOT_FOUND] sprint no existe')

  const retro = await prisma.retrospective.create({
    data: {
      title: input.title.trim(),
      sprintId: input.sprintId,
      format,
      notes: input.notes?.trim() || null,
      facilitatorId: input.facilitatorId || null,
      data: emptyData(format) as unknown as Parameters<typeof prisma.retrospective.create>[0]['data']['data'],
    },
  })

  await recordAuditEventSafe({
    action: 'retrospective.created',
    entityType: 'retrospective',
    entityId: retro.id,
    after: { sprintId: input.sprintId, format },
  })

  revalidatePath(`/projects/${sprint.projectId}/sprints/${input.sprintId}/retrospective`)
  return retro
}

export async function addRetroItem(input: {
  retrospectiveId: string
  categoryId: string
  text: string
  authorId?: string | null
}) {
  if (!input.retrospectiveId) throw new Error('[INVALID_INPUT] retrospectiveId requerido')
  if (!input.categoryId) throw new Error('[INVALID_INPUT] categoryId requerido')
  const text = input.text?.trim()
  if (!text) throw new Error('[INVALID_INPUT] text requerido')

  const retro = await loadRetroOrThrow(input.retrospectiveId)
  const data = normalizeData(retro.data, retro.format)
  const cat = data.categories[input.categoryId]
  if (!cat) throw new Error('[INVALID_INPUT] categoryId no aplica al format')

  const item: RetroItem = {
    id: generateItemId(),
    text,
    votes: [],
    authorId: input.authorId || null,
    taskId: null,
  }
  cat.items.push(item)

  await persistData(retro.id, data)
  await recordAuditEventSafe({
    action: 'retrospective.item_added',
    entityType: 'retrospective',
    entityId: retro.id,
    after: { categoryId: input.categoryId, itemId: item.id },
  })

  revalidateRetro(retro.id, retro.sprintId)
  return item
}

export async function updateRetroItemText(input: {
  retrospectiveId: string
  itemId: string
  text: string
}) {
  if (!input.retrospectiveId || !input.itemId) {
    throw new Error('[INVALID_INPUT] retrospectiveId + itemId requeridos')
  }
  const text = input.text?.trim()
  if (!text) throw new Error('[INVALID_INPUT] text requerido')

  const retro = await loadRetroOrThrow(input.retrospectiveId)
  const data = normalizeData(retro.data, retro.format)

  let updated: RetroItem | null = null
  for (const cat of Object.values(data.categories)) {
    const idx = cat.items.findIndex((i) => i.id === input.itemId)
    if (idx >= 0) {
      cat.items[idx] = { ...cat.items[idx], text }
      updated = cat.items[idx]
      break
    }
  }
  if (!updated) throw new Error('[NOT_FOUND] item no encontrado')

  await persistData(retro.id, data)
  revalidateRetro(retro.id, retro.sprintId)
  return updated
}

export async function removeRetroItem(input: {
  retrospectiveId: string
  itemId: string
}) {
  if (!input.retrospectiveId || !input.itemId) {
    throw new Error('[INVALID_INPUT] retrospectiveId + itemId requeridos')
  }
  const retro = await loadRetroOrThrow(input.retrospectiveId)
  const data = normalizeData(retro.data, retro.format)

  let removed: RetroItem | null = null
  for (const cat of Object.values(data.categories)) {
    const idx = cat.items.findIndex((i) => i.id === input.itemId)
    if (idx >= 0) {
      removed = cat.items[idx]
      cat.items.splice(idx, 1)
      break
    }
  }
  if (!removed) throw new Error('[NOT_FOUND] item no encontrado')

  await persistData(retro.id, data)
  await recordAuditEventSafe({
    action: 'retrospective.item_removed',
    entityType: 'retrospective',
    entityId: retro.id,
    after: { itemId: input.itemId },
  })
  revalidateRetro(retro.id, retro.sprintId)
  return { ok: true }
}

export async function toggleRetroItemVote(input: {
  retrospectiveId: string
  itemId: string
  userId: string
}) {
  if (!input.retrospectiveId || !input.itemId || !input.userId) {
    throw new Error('[INVALID_INPUT] retrospectiveId + itemId + userId requeridos')
  }
  const retro = await loadRetroOrThrow(input.retrospectiveId)
  const data = normalizeData(retro.data, retro.format)

  let updated: RetroItem | null = null
  let didAdd = false
  for (const cat of Object.values(data.categories)) {
    const idx = cat.items.findIndex((i) => i.id === input.itemId)
    if (idx >= 0) {
      const cur = cat.items[idx]
      const has = cur.votes.includes(input.userId)
      const nextVotes = has
        ? cur.votes.filter((v) => v !== input.userId)
        : [...cur.votes, input.userId]
      didAdd = !has
      cat.items[idx] = { ...cur, votes: nextVotes }
      updated = cat.items[idx]
      break
    }
  }
  if (!updated) throw new Error('[NOT_FOUND] item no encontrado')

  await persistData(retro.id, data)
  await recordAuditEventSafe({
    action: didAdd ? 'retrospective.vote_added' : 'retrospective.vote_removed',
    entityType: 'retrospective',
    entityId: retro.id,
    after: { itemId: input.itemId, userId: input.userId },
  })
  revalidateRetro(retro.id, retro.sprintId)
  return updated
}

/**
 * Convierte un item de retro en una Task (action item). Crea la Task
 * en el proyecto del sprint, vincula el `taskId` en el item.
 *
 * Idempotente: si el item ya tiene `taskId`, no crea otra; retorna la
 * existente.
 */
export async function convertRetroItemToTask(input: {
  retrospectiveId: string
  itemId: string
  taskTitle?: string
  assigneeId?: string | null
}) {
  if (!input.retrospectiveId || !input.itemId) {
    throw new Error('[INVALID_INPUT] retrospectiveId + itemId requeridos')
  }

  const retro = await loadRetroOrThrow(input.retrospectiveId)
  const data = normalizeData(retro.data, retro.format)
  const projectId = retro.sprint.projectId

  let item: RetroItem | null = null
  let categoryId: string | null = null
  for (const [catId, cat] of Object.entries(data.categories)) {
    const found = cat.items.find((i) => i.id === input.itemId)
    if (found) {
      item = found
      categoryId = catId
      break
    }
  }
  if (!item || !categoryId) throw new Error('[NOT_FOUND] item no encontrado')

  if (item.taskId) {
    // Ya existe — idempotente.
    const existing = await prisma.task.findUnique({ where: { id: item.taskId } })
    if (existing) return { task: existing, alreadyExisted: true }
  }

  // Crear task con title = item.text (truncado) o `taskTitle` override.
  const title = (input.taskTitle?.trim() || item.text).slice(0, 200)
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  })
  const prefix =
    project?.name.split(' ').map((w) => w[0]).join('').substring(0, 4).toUpperCase() ||
    'RETRO'
  const count = await prisma.task.count({ where: { projectId } })
  const mnemonic = `${prefix}-${count + 1}`

  const task = await prisma.task.create({
    data: {
      title,
      mnemonic,
      description: `Action item generado desde retrospectiva "${retro.title}".\n\n> ${item.text}`,
      projectId,
      type: 'AGILE_STORY',
      status: 'TODO',
      priority: 'MEDIUM',
      assigneeId: input.assigneeId || null,
    },
  })

  // Vincular taskId al item.
  for (const cat of Object.values(data.categories)) {
    const idx = cat.items.findIndex((i) => i.id === input.itemId)
    if (idx >= 0) {
      cat.items[idx] = { ...cat.items[idx], taskId: task.id }
      break
    }
  }
  await persistData(retro.id, data)

  await recordAuditEventSafe({
    action: 'retrospective.action_item_created',
    entityType: 'retrospective',
    entityId: retro.id,
    after: { itemId: item.id, taskId: task.id },
  })

  revalidatePath(`/projects/${projectId}/sprints/${retro.sprintId}/retrospective`)
  revalidatePath('/list')
  revalidatePath('/kanban')

  return { task, alreadyExisted: false }
}

export async function completeRetrospective(input: { id: string }) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const retro = await prisma.retrospective.findUnique({
    where: { id: input.id },
    select: { id: true, completedAt: true, sprint: { select: { projectId: true } }, sprintId: true },
  })
  if (!retro) throw new Error('[NOT_FOUND] retrospectiva no existe')
  if (retro.completedAt) return { ok: true, alreadyCompleted: true }

  await prisma.retrospective.update({
    where: { id: input.id },
    data: { completedAt: new Date() },
  })

  await recordAuditEventSafe({
    action: 'retrospective.completed',
    entityType: 'retrospective',
    entityId: input.id,
  })

  revalidatePath(
    `/projects/${retro.sprint.projectId}/sprints/${retro.sprintId}/retrospective`,
  )
  return { ok: true }
}
