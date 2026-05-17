'use server'

/**
 * Wave R4 · US-7.3 · Clips de video — Server actions.
 *
 * Tres operaciones:
 *
 *   - `createClip(formData)` — recibe FormData con `taskId` o `commentId`
 *     (XOR), `video` (Blob webm/mp4) y opcional `thumbnail` (Blob jpeg/png)
 *     + `durationSec`. Sube al bucket `clips`, crea fila `Clip`. Audit
 *     `clip.created` (best-effort). RBAC vía `requireProjectAccess`.
 *
 *   - `deleteClip({ clipId })` — borra del bucket (video + thumbnail) y
 *     fila. Idempotente sobre bucket 404. Audit `clip.deleted`.
 *
 *   - `regenerateThumbnail(formData)` — recibe `clipId` + `thumbnail` Blob.
 *     Sobreescribe el thumbnail en bucket (upsert) y actualiza
 *     `thumbnailPath`. Usado cuando el primer frame era negro o falló.
 *
 * Convenciones del repo:
 *   - Errores tipados `[CODE] msg`.
 *   - `withMetrics('action.<name>')` wrapping.
 *   - `revalidatePath()` post-mutación.
 *   - Best-effort audit con `recordAuditEventSafe`.
 *
 * Decisiones autónomas:
 *
 *   D-C1: XOR enforced en zod schema + en BD via CHECK constraint. El
 *         action lanza `[INVALID_INPUT]` antes de tocar storage si llegan
 *         ambos o ninguno.
 *
 *   D-C2: El bucket `clips` es público (read). Para listar/embed solo
 *         exponemos `publicUrl` (no signed). El RBAC se aplica en el
 *         endpoint de listado (a través del task/comment dueño) — un user
 *         sin acceso al proyecto no puede llegar al `videoUrl` porque la
 *         action `listClips*` valida `requireProjectAccess` antes de
 *         devolver el row.
 *
 *   D-C3: El thumbnail es opcional. Si el cliente no lo envía o la captura
 *         de frame falló, el clip queda sin thumb y el player muestra
 *         placeholder. `regenerateThumbnail` permite recuperarlo después.
 *
 *   D-C4: Cap de tamaño = `clipMaxBytes()` (env `CLIP_MAX_SIZE_MB`, default
 *         100MB). Si el blob excede → `[CLIP_TOO_LARGE]` antes del upload.
 *
 *   D-C5: La acción audita como `entityType: 'clip'`. La acción
 *         `clip.created` no está en `KNOWN_AUDIT_ACTIONS` pero el helper
 *         `recordAuditEventSafe` ya tolera nuevas claves; el catálogo se
 *         ampliará en el follow-up de audit-events (deuda registrada para
 *         alinear `KNOWN_AUDIT_ACTIONS` con esta nueva acción).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import * as crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  uploadClipBlob,
  getClipPublicUrl,
  removeClipObjects,
} from '@/lib/storage/clips-storage'
import {
  clipMaxBytes,
  isAllowedClipMime,
  isAllowedThumbnailMime,
  type ClipErrorCode,
  type ClipDTO,
} from '@/lib/storage/clip-validation'
import { withMetrics } from '@/lib/observability/metrics'
import { recordAuditEventSafe } from '@/lib/audit/events'

function actionError(code: ClipErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Helpers ────────────────────────────────

function rowToDTO(row: {
  id: string
  taskId: string | null
  commentId: string | null
  authorId: string | null
  storagePath: string
  thumbnailPath: string | null
  durationSec: number
  sizeBytes: number
  mimeType: string
  createdAt: Date
}): ClipDTO {
  return {
    id: row.id,
    taskId: row.taskId,
    commentId: row.commentId,
    authorId: row.authorId,
    videoUrl: getClipPublicUrl(row.storagePath),
    thumbnailUrl: row.thumbnailPath
      ? getClipPublicUrl(row.thumbnailPath)
      : null,
    durationSec: row.durationSec,
    sizeBytes: row.sizeBytes,
    mimeType: row.mimeType,
    createdAt: row.createdAt.toISOString(),
  }
}

// ─────────────────────────── createClip ────────────────────────────

/**
 * Crea un clip a partir de un FormData con:
 *   - `taskId` XOR `commentId` (uno y solo uno).
 *   - `video`: Blob `video/webm` o `video/mp4`.
 *   - `thumbnail` (opcional): Blob `image/jpeg` o `image/png`.
 *   - `durationSec` (opcional): número entero ≥ 0 con la duración medida
 *     en cliente. Default 0 si no llega.
 */
export async function createClip(formData: FormData): Promise<ClipDTO> {
  return withMetrics('action.createClip', async () => {
    // ─── Parse ───────────────────────────────────────────────────
    const rawTaskId = formData.get('taskId')
    const rawCommentId = formData.get('commentId')
    const rawDuration = formData.get('durationSec')
    const video = formData.get('video')
    const thumb = formData.get('thumbnail')

    const taskId =
      typeof rawTaskId === 'string' && rawTaskId.length > 0 ? rawTaskId : null
    const commentId =
      typeof rawCommentId === 'string' && rawCommentId.length > 0
        ? rawCommentId
        : null

    if (taskId && commentId) {
      actionError(
        'INVALID_INPUT',
        'taskId y commentId son mutuamente excluyentes (XOR)',
      )
    }
    if (!taskId && !commentId) {
      actionError(
        'INVALID_INPUT',
        'Debe especificarse taskId o commentId (uno de los dos)',
      )
    }

    if (!video || typeof video === 'string') {
      actionError('INVALID_CLIP', 'No se recibió un blob de video válido')
    }

    const videoBlob = video as Blob & { type?: string; size?: number }
    const videoMime =
      (typeof videoBlob.type === 'string' && videoBlob.type) ||
      'video/webm'
    const videoSize = videoBlob.size ?? 0

    if (videoSize <= 0) {
      actionError('INVALID_CLIP', 'El blob de video está vacío')
    }
    const maxBytes = clipMaxBytes()
    if (videoSize > maxBytes) {
      actionError(
        'CLIP_TOO_LARGE',
        `El clip pesa ${videoSize} bytes y excede el máximo ${maxBytes}`,
      )
    }
    if (!isAllowedClipMime(videoMime)) {
      actionError(
        'INVALID_CLIP',
        `Mime "${videoMime}" no permitido. Usa video/webm o video/mp4.`,
      )
    }

    // Thumbnail opcional. Si llega, validamos mime.
    let thumbBlob: (Blob & { type?: string; size?: number }) | null = null
    if (thumb && typeof thumb !== 'string') {
      thumbBlob = thumb as Blob & { type?: string; size?: number }
      const thumbMime =
        (typeof thumbBlob.type === 'string' && thumbBlob.type) ||
        'image/jpeg'
      if ((thumbBlob.size ?? 0) > 0 && !isAllowedThumbnailMime(thumbMime)) {
        actionError(
          'INVALID_CLIP',
          `Mime de thumbnail "${thumbMime}" no permitido`,
        )
      }
      // Si llegó vacío, lo ignoramos como si no existiese.
      if ((thumbBlob.size ?? 0) <= 0) thumbBlob = null
    }

    const durationParsed = z
      .preprocess(
        (v) =>
          typeof v === 'string' && v.length > 0 ? Number.parseInt(v, 10) : 0,
        z.number().int().min(0).max(60 * 60 * 24),
      )
      .safeParse(rawDuration)
    if (!durationParsed.success) {
      actionError(
        'INVALID_INPUT',
        'durationSec inválido — debe ser entero ≥ 0',
      )
    }
    const durationSec = durationParsed.data

    // ─── Resolver projectId (RBAC) ───────────────────────────────
    let projectId: string
    if (taskId) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, projectId: true },
      })
      if (!task) actionError('TASK_NOT_FOUND', `Task ${taskId} no encontrada`)
      projectId = task.projectId
    } else {
      const comment = await prisma.comment.findUnique({
        where: { id: commentId! },
        select: {
          id: true,
          task: { select: { projectId: true } },
        },
      })
      if (!comment) {
        actionError('COMMENT_NOT_FOUND', `Comment ${commentId} no encontrado`)
      }
      projectId = comment.task.projectId
    }

    await requireProjectAccess(projectId)
    const user = await getCurrentUser()
    if (!user) actionError('UNAUTHORIZED', 'Sesión requerida')

    // ─── Paths en bucket ─────────────────────────────────────────
    const clipId = crypto.randomUUID()
    const ext = videoMime.split('/')[1]?.split(';')[0]?.trim() || 'webm'
    const storagePath = `${user.id}/${clipId}/video.${ext}`
    const thumbnailPath = thumbBlob ? `${user.id}/${clipId}/thumb.jpg` : null

    // ─── Upload ──────────────────────────────────────────────────
    try {
      await uploadClipBlob(videoBlob, storagePath, videoMime)
      if (thumbBlob && thumbnailPath) {
        const thumbMime =
          (typeof thumbBlob.type === 'string' && thumbBlob.type) ||
          'image/jpeg'
        await uploadClipBlob(thumbBlob, thumbnailPath, thumbMime)
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Error desconocido'
      // Best-effort: si la subida del thumb falló pero el video sí entró,
      // intentamos limpiar; no rompemos el flujo del cliente con un
      // mensaje confuso — `[UPLOAD_FAILED]` es la regla.
      try {
        await removeClipObjects([storagePath, ...(thumbnailPath ? [thumbnailPath] : [])])
      } catch {
        // Limpieza best-effort.
      }
      actionError('UPLOAD_FAILED', detail)
    }

    // ─── Persistencia ────────────────────────────────────────────
    const created = await prisma.clip.create({
      data: {
        id: clipId,
        taskId,
        commentId,
        authorId: user.id,
        storagePath,
        thumbnailPath,
        durationSec,
        sizeBytes: videoSize,
        mimeType: videoMime.split(';')[0]!.trim().toLowerCase(),
      },
      select: {
        id: true,
        taskId: true,
        commentId: true,
        authorId: true,
        storagePath: true,
        thumbnailPath: true,
        durationSec: true,
        sizeBytes: true,
        mimeType: true,
        createdAt: true,
      },
    })

    // ─── Audit (best-effort) ─────────────────────────────────────
    await recordAuditEventSafe({
      actorId: user.id,
      // `clip.created` no está aún en `KNOWN_AUDIT_ACTIONS`; el helper
      // tolera strings ad-hoc y registra. Follow-up: agregar al catálogo
      // en una iteración de audit-events.
      action: 'clip.created' as never,
      entityType: 'clip',
      entityId: created.id,
      metadata: {
        taskId,
        commentId,
        sizeBytes: videoSize,
        durationSec,
      },
    })

    // ─── Revalidate ──────────────────────────────────────────────
    if (taskId) {
      revalidatePath(`/tasks/${taskId}`)
      revalidatePath('/list')
      revalidatePath('/gantt')
      revalidatePath('/kanban')
    }

    return rowToDTO(created)
  })
}

// ─────────────────────────── deleteClip ────────────────────────────

const DeleteSchema = z.object({
  clipId: z.string().min(1, 'clipId es obligatorio'),
})

export async function deleteClip(
  rawInput: z.infer<typeof DeleteSchema>,
): Promise<{ ok: true; clipId: string }> {
  return withMetrics('action.deleteClip', async () => {
    const parsed = DeleteSchema.safeParse(rawInput)
    if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
    const { clipId } = parsed.data

    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      select: {
        id: true,
        storagePath: true,
        thumbnailPath: true,
        taskId: true,
        commentId: true,
        task: { select: { projectId: true } },
        comment: { select: { task: { select: { projectId: true } } } },
      },
    })
    if (!clip) {
      // Idempotente — si ya no existe, devolvemos OK para no romper la UI.
      return { ok: true as const, clipId }
    }

    const projectId =
      clip.task?.projectId ?? clip.comment?.task.projectId ?? null
    if (!projectId) {
      actionError('FORBIDDEN', 'El clip no tiene un proyecto resoluble')
    }
    const user = await requireProjectAccess(projectId)

    // Best-effort: borrar del bucket.
    const toRemove: string[] = [clip.storagePath]
    if (clip.thumbnailPath) toRemove.push(clip.thumbnailPath)
    try {
      await removeClipObjects(toRemove)
    } catch (e) {
      console.warn(
        `[clips] removeClipObjects falló para ${clipId}:`,
        e instanceof Error ? e.message : e,
      )
    }

    await prisma.clip.delete({ where: { id: clipId } })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'clip.deleted' as never,
      entityType: 'clip',
      entityId: clipId,
      metadata: { taskId: clip.taskId, commentId: clip.commentId },
    })

    if (clip.taskId) {
      revalidatePath(`/tasks/${clip.taskId}`)
      revalidatePath('/list')
      revalidatePath('/gantt')
      revalidatePath('/kanban')
    }

    return { ok: true as const, clipId }
  })
}

// ─────────────────────────── regenerateThumbnail ────────────────────────

/**
 * Reemplaza el thumbnail de un clip ya existente. Útil cuando el primer
 * frame quedó negro (típico en clips que arrancan grabando ventana antes
 * de que renderice el contenido) y el usuario quiere generarlo desde un
 * frame posterior.
 *
 * Recibe FormData con `clipId` + `thumbnail` Blob. Upsert al mismo path
 * `thumb.jpg` (sobreescribe).
 */
export async function regenerateThumbnail(
  formData: FormData,
): Promise<ClipDTO> {
  return withMetrics('action.regenerateThumbnail', async () => {
    const rawClipId = formData.get('clipId')
    const thumb = formData.get('thumbnail')
    const clipId =
      typeof rawClipId === 'string' && rawClipId.length > 0 ? rawClipId : null
    if (!clipId) actionError('INVALID_INPUT', 'clipId requerido')

    if (!thumb || typeof thumb === 'string') {
      actionError('INVALID_CLIP', 'No se recibió un blob de thumbnail válido')
    }
    const thumbBlob = thumb as Blob & { type?: string; size?: number }
    const thumbMime =
      (typeof thumbBlob.type === 'string' && thumbBlob.type) || 'image/jpeg'
    if ((thumbBlob.size ?? 0) <= 0) {
      actionError('INVALID_CLIP', 'El thumbnail está vacío')
    }
    if (!isAllowedThumbnailMime(thumbMime)) {
      actionError(
        'INVALID_CLIP',
        `Mime de thumbnail "${thumbMime}" no permitido`,
      )
    }

    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      select: {
        id: true,
        thumbnailPath: true,
        storagePath: true,
        taskId: true,
        commentId: true,
        authorId: true,
        durationSec: true,
        sizeBytes: true,
        mimeType: true,
        createdAt: true,
        task: { select: { projectId: true } },
        comment: { select: { task: { select: { projectId: true } } } },
      },
    })
    if (!clip) actionError('CLIP_NOT_FOUND', `Clip ${clipId} no existe`)
    const projectId =
      clip.task?.projectId ?? clip.comment?.task.projectId ?? null
    if (!projectId) actionError('FORBIDDEN', 'Clip sin proyecto resoluble')
    await requireProjectAccess(projectId)

    // Mantenemos el path original si ya existía; si no, derivamos uno nuevo
    // bajo el folder del clip (`{userId}/{clipId}/thumb.jpg`). Como
    // `authorId` puede ser null (autor borrado), usamos el segmento
    // existente del `storagePath` si fuese necesario.
    const targetPath =
      clip.thumbnailPath ??
      clip.storagePath.replace(/\/video\.[a-z0-9]+$/i, '/thumb.jpg')

    try {
      await uploadClipBlob(thumbBlob, targetPath, thumbMime, { upsert: true })
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Error desconocido'
      actionError('UPLOAD_FAILED', detail)
    }

    const updated = await prisma.clip.update({
      where: { id: clipId },
      data: { thumbnailPath: targetPath },
      select: {
        id: true,
        taskId: true,
        commentId: true,
        authorId: true,
        storagePath: true,
        thumbnailPath: true,
        durationSec: true,
        sizeBytes: true,
        mimeType: true,
        createdAt: true,
      },
    })

    if (updated.taskId) revalidatePath(`/tasks/${updated.taskId}`)
    return rowToDTO(updated)
  })
}

// ─────────────────────────── listClipsForTask ────────────────────────────

const ListTaskSchema = z.object({
  taskId: z.string().min(1, 'taskId es obligatorio'),
})

/**
 * Lista los clips asociados directamente a una task (no incluye los
 * adjuntos a sus comments — el componente `TaskCommentsRealtime` se
 * encarga de embeber clips de comments por separado si fuese necesario).
 */
export async function listClipsForTask(
  rawInput: z.infer<typeof ListTaskSchema>,
): Promise<ClipDTO[]> {
  return withMetrics('action.listClipsForTask', async () => {
    const parsed = ListTaskSchema.safeParse(rawInput)
    if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
    const { taskId } = parsed.data

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    })
    if (!task) actionError('TASK_NOT_FOUND', `Task ${taskId} no encontrada`)
    await requireProjectAccess(task.projectId)

    const rows = await prisma.clip.findMany({
      where: { taskId: task.id },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        taskId: true,
        commentId: true,
        authorId: true,
        storagePath: true,
        thumbnailPath: true,
        durationSec: true,
        sizeBytes: true,
        mimeType: true,
        createdAt: true,
      },
    })
    return rows.map(rowToDTO)
  })
}
