'use server'

/**
 * Wave P8 · Equipo P8-4 — Server actions de Attachments (lista + delete).
 *
 * Las actions de upload + signed URL viven en `@/lib/storage/upload-attachment`
 * y `@/lib/storage/get-signed-url` (separadas para limitar superficie y
 * facilitar test); aquí concentramos las operaciones CRUD restantes:
 *
 *   - `listAttachmentsForTask(taskId)` — lectura ordenada por `uploadedAt desc`.
 *   - `deleteAttachment(attachmentId)` — borra del bucket (best-effort) y
 *     elimina la fila. Idempotente sobre el bucket: si el objeto ya no
 *     existe, no falla la transacción.
 *
 * Convenciones:
 *   - Errores tipados `[INVALID_INPUT]`, `[TASK_NOT_FOUND]`,
 *     `[ATTACHMENT_NOT_FOUND]`, `[FORBIDDEN]`.
 *   - `requireProjectAccess` via task.
 *   - `revalidatePath` después de mutar.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { removeAttachment } from '@/lib/storage/supabase-storage'
import type { AttachmentDTO } from '@/lib/storage/attachment-validation'

// ─────────────────────────── Errores tipados ──────────────────────────

export type AttachmentsErrorCode =
  | 'INVALID_INPUT'
  | 'TASK_NOT_FOUND'
  | 'ATTACHMENT_NOT_FOUND'
  | 'FORBIDDEN'

function actionError(code: AttachmentsErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas ────────────────────────────────

const ListSchema = z.object({
  taskId: z.string().min(1, 'taskId es obligatorio'),
})

const DeleteSchema = z.object({
  attachmentId: z.string().min(1, 'attachmentId es obligatorio'),
})

// ─────────────────────────── Helpers ────────────────────────────────

function toDTO(row: {
  id: string
  taskId: string
  filename: string
  storagePath: string | null
  mimeType: string | null
  mimetype: string | null
  sizeBytes: number | null
  size: number | null
  uploadedById: string | null
  uploadedAt: Date
  createdAt: Date
}): AttachmentDTO {
  return {
    id: row.id,
    taskId: row.taskId,
    filename: row.filename,
    storagePath: row.storagePath,
    // Fallback al mime/size legacy si los nuevos están vacíos (rows previas).
    mimeType: row.mimeType ?? row.mimetype ?? null,
    sizeBytes: row.sizeBytes ?? row.size ?? null,
    uploadedById: row.uploadedById,
    uploadedAt: row.uploadedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

// ─────────────────────────── Reads ───────────────────────────────────

export async function listAttachmentsForTask(
  rawInput: z.infer<typeof ListSchema>,
): Promise<AttachmentDTO[]> {
  const parsed = ListSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { taskId } = parsed.data

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true },
  })
  if (!task) actionError('TASK_NOT_FOUND', `Tarea ${taskId} no encontrada`)
  await requireProjectAccess(task.projectId)

  const rows = await prisma.attachment.findMany({
    where: { taskId: task.id },
    orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      taskId: true,
      filename: true,
      storagePath: true,
      mimeType: true,
      mimetype: true,
      sizeBytes: true,
      size: true,
      uploadedById: true,
      uploadedAt: true,
      createdAt: true,
    },
  })
  return rows.map(toDTO)
}

// ─────────────────────────── Writes ──────────────────────────────────

/**
 * Borra el attachment del bucket (best-effort) y la fila de DB. Si el
 * objeto ya no existía en el bucket, la operación de DB sigue adelante.
 */
export async function deleteAttachment(
  rawInput: z.infer<typeof DeleteSchema>,
): Promise<{ ok: true; attachmentId: string }> {
  const parsed = DeleteSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { attachmentId } = parsed.data

  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storagePath: true,
      task: { select: { id: true, projectId: true } },
    },
  })
  if (!row) {
    // Idempotente — si ya no existe, no rompemos.
    return { ok: true, attachmentId }
  }

  await requireProjectAccess(row.task.projectId)

  // Best-effort delete en bucket; si falla por red, registramos pero
  // proseguimos para no dejar huérfana la UI.
  if (row.storagePath) {
    try {
      await removeAttachment(row.storagePath)
    } catch (e) {
      // Log silencioso — la fila se borra igualmente. La basura en
      // bucket se puede limpiar con un cron offline (deuda registrada).
      console.warn(
        `[attachments] removeAttachment falló para ${row.storagePath}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  await prisma.attachment.delete({ where: { id: row.id } })

  revalidatePath('/list')
  revalidatePath('/gantt')
  revalidatePath('/kanban')
  revalidatePath(`/tasks/${row.task.id}`)

  return { ok: true, attachmentId }
}
