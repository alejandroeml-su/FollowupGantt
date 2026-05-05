'use server'

/**
 * Wave C-debt-1 · Equipo C-DEBT-1 — Server actions de Checklists.
 *
 * Modelo relacional `Checklist` + `ChecklistItem` (resuelve la deuda P7-5
 * que guardaba el checklist sugerido por IA como markdown anexado a
 * `task.description`).
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle` — códigos:
 *     `[CHECKLIST_NOT_FOUND]`, `[ITEM_NOT_FOUND]`, `[INVALID_INPUT]`,
 *     `[FORBIDDEN]`, `[TASK_NOT_FOUND]`.
 *   - `requireProjectAccess(projectId)` resolviendo el `projectId` desde la
 *     `Task` dueña (o desde la `Checklist` para mutaciones de items).
 *   - `revalidatePath` después de mutar — el drawer y los listados muestran
 *     contadores de items que cambian con cada toggle.
 *   - Validación con zod.
 *
 * Decisiones autónomas (registradas para revisión):
 *   D-CL-1: `position` se asigna como `max(position) + 1` al crear (mismo
 *           patrón que `dependencies.ts` y `custom-fields.ts`). El reorder
 *           reescribe en transacción todas las posiciones del checklist
 *           usando enteros incrementales (1, 2, 3, ...), suficiente para
 *           UI con drag&drop sencillo.
 *   D-CL-2: `deleteChecklistItem` es idempotente — si el item ya no existe
 *           no lanza (alineado con `deleteDependency`).
 *   D-CL-3: `applyAIChecklistSuggestion` crea Checklist + items en una
 *           transacción única. Si la task ya tenía checklists, ESTA crea
 *           UNA NUEVA con `title = "Sugerido por IA"` — no reemplaza ni
 *           dedupe items para no perder trabajo manual del usuario.
 *   D-CL-4: `toggleChecklistItem` setea `doneAt`/`doneById` cuando pasa a
 *           done; los limpia cuando pasa a undone (mismo registro, no
 *           historial). El historial fino vive en `TaskHistory` si se
 *           necesita auditoría granular en futuro.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { getCurrentUser } from '@/lib/auth/get-current-user'

// ─────────────────────────── Errores tipados ──────────────────────────

export type ChecklistErrorCode =
  | 'INVALID_INPUT'
  | 'CHECKLIST_NOT_FOUND'
  | 'ITEM_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'FORBIDDEN'

function actionError(code: ChecklistErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas zod ──────────────────────────────

const TEXT_SCHEMA = z
  .string()
  .trim()
  .min(1, 'El texto es obligatorio')
  .max(500, 'Máximo 500 caracteres')

const TITLE_SCHEMA = z
  .string()
  .trim()
  .min(1)
  .max(200, 'Máximo 200 caracteres')
  .optional()
  .nullable()

const CreateChecklistSchema = z.object({
  taskId: z.string().min(1, 'taskId es obligatorio'),
  title: TITLE_SCHEMA,
  firstItemText: TEXT_SCHEMA.optional(),
})

const AddChecklistItemSchema = z.object({
  checklistId: z.string().min(1, 'checklistId es obligatorio'),
  text: TEXT_SCHEMA,
})

const ToggleChecklistItemSchema = z.object({
  itemId: z.string().min(1, 'itemId es obligatorio'),
})

const DeleteChecklistItemSchema = z.object({
  itemId: z.string().min(1, 'itemId es obligatorio'),
})

const ReorderChecklistItemsSchema = z.object({
  checklistId: z.string().min(1, 'checklistId es obligatorio'),
  itemIds: z.array(z.string().min(1)).min(1, 'itemIds no puede estar vacío'),
})

const ApplyAIChecklistSuggestionSchema = z.object({
  taskId: z.string().min(1, 'taskId es obligatorio'),
  items: z
    .array(
      z.object({
        text: TEXT_SCHEMA,
        optional: z.boolean().optional(),
      }),
    )
    .min(1, 'Debe incluir al menos un item')
    .max(50, 'Máximo 50 items por checklist'),
  title: TITLE_SCHEMA,
})

// ─────────────────────────── Tipos públicos ──────────────────────────

export interface ChecklistItemDTO {
  id: string
  checklistId: string
  text: string
  done: boolean
  position: number
  doneAt: string | null
  doneById: string | null
  createdAt: string
  updatedAt: string
}

export interface ChecklistDTO {
  id: string
  taskId: string
  title: string | null
  createdAt: string
  updatedAt: string
  items: ChecklistItemDTO[]
}

// ─────────────────────────── Helpers privados ────────────────────────

async function loadTaskOrFail(taskId: string): Promise<{
  id: string
  projectId: string
}> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true },
  })
  if (!task) actionError('TASK_NOT_FOUND', `Tarea ${taskId} no encontrada`)
  return task
}

async function loadChecklistOrFail(checklistId: string): Promise<{
  id: string
  taskId: string
  task: { id: string; projectId: string }
}> {
  const checklist = await prisma.checklist.findUnique({
    where: { id: checklistId },
    select: {
      id: true,
      taskId: true,
      task: { select: { id: true, projectId: true } },
    },
  })
  if (!checklist) {
    actionError('CHECKLIST_NOT_FOUND', `Checklist ${checklistId} no existe`)
  }
  return checklist
}

async function loadItemOrFail(itemId: string): Promise<{
  id: string
  checklistId: string
  done: boolean
  checklist: { taskId: string; task: { id: string; projectId: string } }
}> {
  const item = await prisma.checklistItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      checklistId: true,
      done: true,
      checklist: {
        select: {
          taskId: true,
          task: { select: { id: true, projectId: true } },
        },
      },
    },
  })
  if (!item) actionError('ITEM_NOT_FOUND', `Item ${itemId} no existe`)
  return item
}

function toItemDTO(it: {
  id: string
  checklistId: string
  text: string
  done: boolean
  position: number
  doneAt: Date | null
  doneById: string | null
  createdAt: Date
  updatedAt: Date
}): ChecklistItemDTO {
  return {
    id: it.id,
    checklistId: it.checklistId,
    text: it.text,
    done: it.done,
    position: it.position,
    doneAt: it.doneAt ? it.doneAt.toISOString() : null,
    doneById: it.doneById,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  }
}

function revalidateForTask(taskId: string) {
  revalidatePath('/list')
  revalidatePath('/gantt')
  revalidatePath('/kanban')
  revalidatePath(`/tasks/${taskId}`)
}

// ─────────────────────────── Reads ───────────────────────────────────

/**
 * Lectura de checklists para una task (con sus items ordenados por
 * `position`). Llamado desde `TaskChecklistSection` (RSC fetch o client
 * fetch via server action). Verifica acceso al proyecto.
 */
export async function getChecklistsForTask(
  taskId: string,
): Promise<ChecklistDTO[]> {
  const parsed = z.string().min(1).safeParse(taskId)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)

  const task = await loadTaskOrFail(parsed.data)
  await requireProjectAccess(task.projectId)

  const checklists = await prisma.checklist.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: 'asc' },
    include: {
      items: {
        orderBy: { position: 'asc' },
      },
    },
  })

  return checklists.map((cl) => ({
    id: cl.id,
    taskId: cl.taskId,
    title: cl.title,
    createdAt: cl.createdAt.toISOString(),
    updatedAt: cl.updatedAt.toISOString(),
    items: cl.items.map(toItemDTO),
  }))
}

// ─────────────────────────── Writes ──────────────────────────────────

/**
 * Crea un nuevo `Checklist` para la tarea. Si se incluye `firstItemText`,
 * crea también el primer item.
 */
export async function createChecklist(
  rawInput: z.infer<typeof CreateChecklistSchema>,
): Promise<ChecklistDTO> {
  const parsed = CreateChecklistSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { taskId, title, firstItemText } = parsed.data

  const task = await loadTaskOrFail(taskId)
  await requireProjectAccess(task.projectId)

  const created = await prisma.checklist.create({
    data: {
      taskId: task.id,
      title: title ?? null,
      ...(firstItemText
        ? {
            items: {
              create: [{ text: firstItemText, position: 1 }],
            },
          }
        : {}),
    },
    include: { items: { orderBy: { position: 'asc' } } },
  })

  revalidateForTask(task.id)

  return {
    id: created.id,
    taskId: created.taskId,
    title: created.title,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    items: created.items.map(toItemDTO),
  }
}

/**
 * Añade un item al final del checklist (`position = max + 1`).
 */
export async function addChecklistItem(
  rawInput: z.infer<typeof AddChecklistItemSchema>,
): Promise<ChecklistItemDTO> {
  const parsed = AddChecklistItemSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { checklistId, text } = parsed.data

  const checklist = await loadChecklistOrFail(checklistId)
  await requireProjectAccess(checklist.task.projectId)

  const last = await prisma.checklistItem.findFirst({
    where: { checklistId: checklist.id },
    orderBy: { position: 'desc' },
    select: { position: true },
  })
  const nextPos = (last?.position ?? 0) + 1

  const created = await prisma.checklistItem.create({
    data: {
      checklistId: checklist.id,
      text,
      position: nextPos,
    },
  })

  revalidateForTask(checklist.taskId)
  return toItemDTO(created)
}

/**
 * Cambia el estado `done` del item. Cuando pasa a done setea `doneAt = now`
 * y `doneById = currentUserId`. Cuando regresa a undone, los limpia.
 */
export async function toggleChecklistItem(
  rawInput: z.infer<typeof ToggleChecklistItemSchema>,
): Promise<ChecklistItemDTO> {
  const parsed = ToggleChecklistItemSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { itemId } = parsed.data

  const item = await loadItemOrFail(itemId)
  await requireProjectAccess(item.checklist.task.projectId)
  const user = await getCurrentUser()

  const newDone = !item.done
  const updated = await prisma.checklistItem.update({
    where: { id: item.id },
    data: {
      done: newDone,
      doneAt: newDone ? new Date() : null,
      doneById: newDone ? user?.id ?? null : null,
    },
  })

  revalidateForTask(item.checklist.taskId)
  return toItemDTO(updated)
}

/**
 * Borra un item. Idempotente: si ya no existe, retorna sin lanzar.
 */
export async function deleteChecklistItem(
  rawInput: z.infer<typeof DeleteChecklistItemSchema>,
): Promise<{ ok: true; itemId: string }> {
  const parsed = DeleteChecklistItemSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { itemId } = parsed.data

  const existing = await prisma.checklistItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      checklist: {
        select: {
          taskId: true,
          task: { select: { projectId: true } },
        },
      },
    },
  })

  if (!existing) {
    // Idempotente: no lanza.
    return { ok: true, itemId }
  }

  await requireProjectAccess(existing.checklist.task.projectId)

  await prisma.checklistItem.delete({ where: { id: itemId } })

  revalidateForTask(existing.checklist.taskId)
  return { ok: true, itemId }
}

/**
 * Reordena items asignando posiciones enteras 1..N en el orden recibido.
 * Verifica que todos los `itemIds` pertenezcan al mismo checklist y se
 * cubren todos los items existentes (no se permite "olvidar" items).
 */
export async function reorderChecklistItems(
  rawInput: z.infer<typeof ReorderChecklistItemsSchema>,
): Promise<{ ok: true; checklistId: string; count: number }> {
  const parsed = ReorderChecklistItemsSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { checklistId, itemIds } = parsed.data

  // Detectar duplicados en `itemIds`.
  if (new Set(itemIds).size !== itemIds.length) {
    actionError('INVALID_INPUT', 'itemIds contiene duplicados')
  }

  const checklist = await loadChecklistOrFail(checklistId)
  await requireProjectAccess(checklist.task.projectId)

  // Cargar todos los items del checklist para validar membership.
  const existing = await prisma.checklistItem.findMany({
    where: { checklistId: checklist.id },
    select: { id: true },
  })
  const existingIds = new Set(existing.map((it) => it.id))

  // Cada itemId del payload debe pertenecer al checklist.
  for (const id of itemIds) {
    if (!existingIds.has(id)) {
      actionError(
        'INVALID_INPUT',
        `Item ${id} no pertenece al checklist ${checklistId}`,
      )
    }
  }
  // Toda la lista del checklist debe estar cubierta — evitamos olvidos.
  if (existing.length !== itemIds.length) {
    actionError(
      'INVALID_INPUT',
      `itemIds debe incluir los ${existing.length} items del checklist (recibidos: ${itemIds.length})`,
    )
  }

  // Transacción: una update por item con position 1..N.
  await prisma.$transaction(
    itemIds.map((id, idx) =>
      prisma.checklistItem.update({
        where: { id },
        data: { position: idx + 1 },
      }),
    ),
  )

  revalidateForTask(checklist.taskId)
  return { ok: true, checklistId: checklist.id, count: itemIds.length }
}

/**
 * Aplica una sugerencia de checklist generada por IA (P7-5):
 *   1. Crea un nuevo `Checklist` (titulo "Sugerido por IA" salvo override)
 *      vinculado a la task.
 *   2. Crea N items con position 1..N en orden recibido.
 *   3. Todo en una sola transacción.
 *
 * No reemplaza checklists existentes — añade uno nuevo. El usuario puede
 * borrar el viejo si lo desea.
 */
export async function applyAIChecklistSuggestion(
  rawInput: z.infer<typeof ApplyAIChecklistSuggestionSchema>,
): Promise<ChecklistDTO> {
  const parsed = ApplyAIChecklistSuggestionSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { taskId, items, title } = parsed.data

  const task = await loadTaskOrFail(taskId)
  await requireProjectAccess(task.projectId)

  const created = await prisma.checklist.create({
    data: {
      taskId: task.id,
      title: title ?? 'Sugerido por IA',
      items: {
        create: items.map((it, idx) => ({
          text: it.text,
          position: idx + 1,
          // `optional` no se persiste como columna — se mantiene en la
          // sugerencia para informar al usuario, pero el modelo
          // ChecklistItem no lo distingue (mantener el schema simple).
        })),
      },
    },
    include: { items: { orderBy: { position: 'asc' } } },
  })

  revalidateForTask(task.id)

  return {
    id: created.id,
    taskId: created.taskId,
    title: created.title,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    items: created.items.map(toItemDTO),
  }
}
