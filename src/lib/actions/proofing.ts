'use server'

/**
 * US-7.5 · Proofing (R4) — Server actions de anotaciones ancladas.
 *
 * Modelo de datos: `ProofingAnnotation` cuelga de `Attachment`. Coordenadas
 * `(x, y)` están normalizadas en [0..1] respecto al bounding-box renderizado
 * por el canvas (independiente del tamaño actual del viewport). Threading
 * via `parentAnnotationId` self-reference. Status workflow:
 *
 *   OPEN ──► RESOLVED
 *      │       ▲
 *      ▼       │
 *   CHANGES_REQUESTED
 *      │
 *      └──► RESOLVED
 *
 * Reopen: cualquier estado → OPEN (limpia `resolvedAt/resolvedById`).
 *
 * Convenciones del repo:
 *   - Errores tipados `[CODE] mensaje`.
 *   - Validación zod por entrada.
 *   - RBAC via `requireProjectAccess(attachment.task.projectId)`.
 *   - Audit events `proofing.annotation_*` (best-effort `recordAuditEventSafe`).
 *   - Notification al uploader/author del attachment cuando un tercero
 *     crea/replies una anotación (usa `createNotification` para que el
 *     centro de notificaciones in-app + push lo recojan).
 *   - `revalidatePath` por proyecto + drawer de task.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma, type ProofingAnnotationStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { createNotification } from '@/lib/actions/notifications'

// ───────────────────────── Errores tipados ─────────────────────────

export type ProofingErrorCode =
  | 'INVALID_INPUT'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ANNOTATION_NOT_FOUND'
  | 'PARENT_MISMATCH'
  | 'FORBIDDEN'

function actionError(code: ProofingErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

/**
 * Coordenadas normalizadas. Las validamos estrictamente en [0..1] para
 * evitar que un bug de cliente persista markers fuera del canvas. El check
 * SQL las re-valida en BD; doble defensa porque la confianza en el render
 * es baja (zoom, scroll, etc.).
 */
const coordSchema = z.number().finite().min(0).max(1)

const PROOFING_STATUSES = [
  'OPEN',
  'RESOLVED',
  'CHANGES_REQUESTED',
] as const satisfies readonly ProofingAnnotationStatus[]

const createAnnotationSchema = z.object({
  attachmentId: z.string().min(1, 'attachmentId requerido'),
  x: coordSchema,
  y: coordSchema,
  /** Sólo aplica a PDFs multi-página (1-indexed). NULL → imagen o pdf p.1. */
  pageNumber: z.number().int().min(1).max(10000).nullish(),
  text: z
    .string()
    .min(1, 'Comentario vacío')
    .max(4000, 'Comentario demasiado largo'),
  attachmentVersionId: z.string().min(1).nullish(),
  /** Cuando viene seteado, se trata como reply: hereda `attachmentId`. */
  parentAnnotationId: z.string().min(1).nullish(),
})

const replyAnnotationSchema = z.object({
  parentAnnotationId: z.string().min(1, 'parentAnnotationId requerido'),
  text: z.string().min(1).max(4000),
})

const updateStatusSchema = z.object({
  annotationId: z.string().min(1),
  status: z.enum(PROOFING_STATUSES),
})

const deleteSchema = z.object({
  annotationId: z.string().min(1),
})

const listSchema = z.object({
  attachmentId: z.string().min(1),
  /** Filtro opcional cliente; el server por default devuelve todo. */
  status: z.enum(PROOFING_STATUSES).nullish(),
})

// ───────────────────────── DTO ─────────────────────────

export type ProofingAnnotationDTO = {
  id: string
  attachmentId: string
  attachmentVersionId: string | null
  x: number
  y: number
  pageNumber: number | null
  text: string
  status: ProofingAnnotationStatus
  parentAnnotationId: string | null
  authorId: string | null
  authorName: string | null
  resolvedAt: string | null
  resolvedById: string | null
  resolvedByName: string | null
  createdAt: string
  updatedAt: string
}

type AnnotationRow = {
  id: string
  attachmentId: string
  attachmentVersionId: string | null
  x: number
  y: number
  pageNumber: number | null
  text: string
  status: ProofingAnnotationStatus
  parentAnnotationId: string | null
  authorId: string | null
  resolvedAt: Date | null
  resolvedById: string | null
  createdAt: Date
  updatedAt: Date
  author: { id: string; name: string } | null
  resolvedBy: { id: string; name: string } | null
}

function toDTO(row: AnnotationRow): ProofingAnnotationDTO {
  return {
    id: row.id,
    attachmentId: row.attachmentId,
    attachmentVersionId: row.attachmentVersionId,
    x: row.x,
    y: row.y,
    pageNumber: row.pageNumber,
    text: row.text,
    status: row.status,
    parentAnnotationId: row.parentAnnotationId,
    authorId: row.authorId,
    authorName: row.author?.name ?? null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedById: row.resolvedById,
    resolvedByName: row.resolvedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ───────────────────────── Helpers ─────────────────────────

const annotationInclude = {
  author: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
} satisfies Prisma.ProofingAnnotationInclude

async function loadAttachmentForGate(attachmentId: string) {
  const att = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      filename: true,
      uploadedById: true,
      userId: true,
      task: { select: { id: true, projectId: true } },
    },
  })
  if (!att) actionError('ATTACHMENT_NOT_FOUND', `Attachment ${attachmentId}`)
  return att
}

function revalidateForTask(taskId: string, projectId: string) {
  revalidatePath('/list')
  revalidatePath('/gantt')
  revalidatePath('/kanban')
  revalidatePath(`/tasks/${taskId}`)
  revalidatePath(`/projects/${projectId}`)
}

/**
 * Notifica al uploader/author original del attachment cuando un tercero
 * crea una anotación o reply. Best-effort: cualquier fallo se loguea pero
 * no rompe la transacción de creación.
 */
async function notifyAttachmentOwner(opts: {
  attachmentOwnerId: string | null
  actorId: string | null
  actorName: string | null
  attachmentFilename: string
  taskId: string
  attachmentId: string
  isReply: boolean
}) {
  if (!opts.attachmentOwnerId) return
  // Evita auto-notificarse cuando el dueño del asset comenta su propio archivo.
  if (opts.attachmentOwnerId === opts.actorId) return
  try {
    const verb = opts.isReply ? 'respondió' : 'comentó'
    const who = opts.actorName ? opts.actorName : 'Alguien'
    await createNotification({
      userId: opts.attachmentOwnerId,
      // COMMENT_REPLY es el equivalente semántico hasta que la migración
      // agregue el valor PROOFING_ANNOTATION al enum en prod. Si la migración
      // ya está aplicada, se puede flipear a 'PROOFING_ANNOTATION' aquí.
      type: 'COMMENT_REPLY',
      title: `${who} ${verb} en "${opts.attachmentFilename}"`,
      body: null,
      link: `/tasks/${opts.taskId}?proofing=${opts.attachmentId}`,
      data: {
        attachmentId: opts.attachmentId,
        taskId: opts.taskId,
        source: 'proofing',
      },
    })
  } catch (err) {
    // Edwin reportó 2026-05-XX: las notificaciones nunca deben romper
    // mutaciones core. Sólo log.
    console.warn(
      '[proofing] createNotification falló (no bloquea):',
      err instanceof Error ? err.message : err,
    )
  }
}

// ───────────────────────── Reads ─────────────────────────

/**
 * Lista anotaciones de un attachment ordenadas por `createdAt asc` para
 * que la numeración de markers (1, 2, 3…) sea estable. Incluye replies
 * mezclados en la lista — el cliente decide cómo nestearlos por
 * `parentAnnotationId`.
 */
export async function listAnnotationsForAttachment(
  rawInput: z.input<typeof listSchema>,
): Promise<ProofingAnnotationDTO[]> {
  const parsed = listSchema.safeParse(rawInput)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'inválido')
  }
  const { attachmentId, status } = parsed.data

  const att = await loadAttachmentForGate(attachmentId)
  await requireProjectAccess(att.task.projectId)

  const rows = await prisma.proofingAnnotation.findMany({
    where: {
      attachmentId,
      ...(status ? { status } : {}),
    },
    include: annotationInclude,
    orderBy: [{ createdAt: 'asc' }],
  })
  return rows.map(toDTO)
}

// ───────────────────────── Writes ─────────────────────────

/**
 * Crea una anotación anclada en `(x, y)` normalizadas. Si `parentAnnotationId`
 * está seteado, se trata como reply y el `attachmentId` debe coincidir con el
 * del parent (defensa contra payloads inconsistentes desde cliente).
 */
export async function createAnnotation(
  rawInput: z.input<typeof createAnnotationSchema>,
): Promise<ProofingAnnotationDTO> {
  const parsed = createAnnotationSchema.safeParse(rawInput)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'inválido')
  }
  const data = parsed.data

  const att = await loadAttachmentForGate(data.attachmentId)
  const user = await requireProjectAccess(att.task.projectId)

  // Validación de threading: si viene `parentAnnotationId`, el parent debe
  // existir y pertenecer al MISMO attachment. Cross-attachment thread no se
  // permite (rompe el modelo mental "comentario sobre este archivo").
  if (data.parentAnnotationId) {
    const parent = await prisma.proofingAnnotation.findUnique({
      where: { id: data.parentAnnotationId },
      select: { id: true, attachmentId: true },
    })
    if (!parent) actionError('ANNOTATION_NOT_FOUND', 'parent no existe')
    if (parent.attachmentId !== data.attachmentId) {
      actionError(
        'PARENT_MISMATCH',
        'parentAnnotationId pertenece a otro attachment',
      )
    }
  }

  const created = await prisma.proofingAnnotation.create({
    data: {
      attachmentId: data.attachmentId,
      x: data.x,
      y: data.y,
      pageNumber: data.pageNumber ?? null,
      text: data.text.trim(),
      attachmentVersionId: data.attachmentVersionId ?? null,
      parentAnnotationId: data.parentAnnotationId ?? null,
      authorId: user.id,
      status: 'OPEN',
    },
    include: annotationInclude,
  })

  await recordAuditEventSafe({
    actorId: user.id,
    action: data.parentAnnotationId
      ? 'proofing.annotation_replied'
      : 'proofing.annotation_created',
    entityType: 'proofing_annotation',
    entityId: created.id,
    metadata: {
      attachmentId: data.attachmentId,
      taskId: att.task.id,
      projectId: att.task.projectId,
      parentAnnotationId: data.parentAnnotationId ?? null,
    },
  })

  // Notificación al uploader/author original del attachment (no al replier
  // de un thread — eso lo trataríamos en una iteración posterior con un
  // modelo de "watchers" del thread).
  const ownerId = att.uploadedById ?? att.userId
  await notifyAttachmentOwner({
    attachmentOwnerId: ownerId,
    actorId: user.id,
    actorName: user.name ?? null,
    attachmentFilename: att.filename,
    taskId: att.task.id,
    attachmentId: att.id,
    isReply: Boolean(data.parentAnnotationId),
  })

  revalidateForTask(att.task.id, att.task.projectId)
  return toDTO(created)
}

/**
 * Reply de conveniencia. Internamente delega en `createAnnotation` copiando
 * coordenadas, attachment y version del parent. Esto mantiene una API más
 * legible desde la UI ("replyAnnotation" vs "createAnnotation con parentId").
 */
export async function replyAnnotation(
  rawInput: z.input<typeof replyAnnotationSchema>,
): Promise<ProofingAnnotationDTO> {
  const parsed = replyAnnotationSchema.safeParse(rawInput)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'inválido')
  }
  const { parentAnnotationId, text } = parsed.data

  const parent = await prisma.proofingAnnotation.findUnique({
    where: { id: parentAnnotationId },
    select: {
      id: true,
      attachmentId: true,
      x: true,
      y: true,
      pageNumber: true,
      attachmentVersionId: true,
    },
  })
  if (!parent) actionError('ANNOTATION_NOT_FOUND', 'parent no existe')

  return createAnnotation({
    attachmentId: parent.attachmentId,
    x: parent.x,
    y: parent.y,
    pageNumber: parent.pageNumber ?? undefined,
    text,
    attachmentVersionId: parent.attachmentVersionId ?? undefined,
    parentAnnotationId: parent.id,
  })
}

/**
 * Cambia el status de una anotación. Cuando pasa a RESOLVED, materializa
 * `resolvedAt/resolvedById`; cuando vuelve a OPEN limpia ambos. Audit events
 * separados (`_resolved` / `_reopened` / `_changes_requested`) facilitan
 * filtros desde la UI de auditoría.
 */
export async function updateAnnotationStatus(
  rawInput: z.input<typeof updateStatusSchema>,
): Promise<ProofingAnnotationDTO> {
  const parsed = updateStatusSchema.safeParse(rawInput)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'inválido')
  }
  const { annotationId, status } = parsed.data

  const existing = await prisma.proofingAnnotation.findUnique({
    where: { id: annotationId },
    select: {
      id: true,
      status: true,
      attachmentId: true,
      attachment: {
        select: { task: { select: { id: true, projectId: true } } },
      },
    },
  })
  if (!existing) actionError('ANNOTATION_NOT_FOUND', annotationId)
  const user = await requireProjectAccess(existing.attachment.task.projectId)

  const prevStatus = existing.status

  const updated = await prisma.proofingAnnotation.update({
    where: { id: annotationId },
    data: {
      status,
      resolvedAt: status === 'RESOLVED' ? new Date() : null,
      resolvedById: status === 'RESOLVED' ? user.id : null,
    },
    include: annotationInclude,
  })

  // Auditoría tipada según la transición. El catch-all ('_created') no se
  // usa aquí; es exclusivo para creates.
  let action:
    | 'proofing.annotation_resolved'
    | 'proofing.annotation_reopened'
    | 'proofing.annotation_changes_requested'
    | null = null
  if (status === 'RESOLVED' && prevStatus !== 'RESOLVED') {
    action = 'proofing.annotation_resolved'
  } else if (status === 'OPEN' && prevStatus !== 'OPEN') {
    action = 'proofing.annotation_reopened'
  } else if (
    status === 'CHANGES_REQUESTED' &&
    prevStatus !== 'CHANGES_REQUESTED'
  ) {
    action = 'proofing.annotation_changes_requested'
  }

  if (action) {
    await recordAuditEventSafe({
      actorId: user.id,
      action,
      entityType: 'proofing_annotation',
      entityId: annotationId,
      before: { status: prevStatus },
      after: { status },
      metadata: {
        attachmentId: existing.attachmentId,
        taskId: existing.attachment.task.id,
        projectId: existing.attachment.task.projectId,
      },
    })
  }

  revalidateForTask(
    existing.attachment.task.id,
    existing.attachment.task.projectId,
  )
  return toDTO(updated)
}

/**
 * Borra una anotación. Cascade en BD elimina sus replies. Sólo el author o
 * un usuario con acceso al proyecto pueden borrar (la rule de "sólo author"
 * se difiere — Edwin pidió iterar después con `permissions.canModerate`).
 */
export async function deleteAnnotation(
  rawInput: z.input<typeof deleteSchema>,
): Promise<{ ok: true; annotationId: string }> {
  const parsed = deleteSchema.safeParse(rawInput)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'inválido')
  }
  const { annotationId } = parsed.data

  const existing = await prisma.proofingAnnotation.findUnique({
    where: { id: annotationId },
    select: {
      id: true,
      attachmentId: true,
      attachment: {
        select: { task: { select: { id: true, projectId: true } } },
      },
    },
  })
  if (!existing) {
    // Idempotente — si ya no existe devolvemos OK.
    return { ok: true, annotationId }
  }
  const user = await requireProjectAccess(existing.attachment.task.projectId)

  await prisma.proofingAnnotation.delete({ where: { id: annotationId } })

  await recordAuditEventSafe({
    actorId: user.id,
    action: 'proofing.annotation_deleted',
    entityType: 'proofing_annotation',
    entityId: annotationId,
    metadata: {
      attachmentId: existing.attachmentId,
      taskId: existing.attachment.task.id,
      projectId: existing.attachment.task.projectId,
    },
  })

  revalidateForTask(
    existing.attachment.task.id,
    existing.attachment.task.projectId,
  )
  return { ok: true, annotationId }
}

// ───────────────────────── Versiones (opcional) ─────────────────────────

/**
 * Lista versiones del attachment ordenadas por `version desc`. Devuelve una
 * lista vacía cuando no hay versiones registradas (caso default: el asset
 * original cuenta como "v1 implícita" desde la UI).
 */
export async function listAttachmentVersions(
  rawInput: { attachmentId: string },
): Promise<
  Array<{
    id: string
    attachmentId: string
    version: number
    storagePath: string
    mimeType: string | null
    sizeBytes: number | null
    uploadedById: string | null
    uploadedByName: string | null
    note: string | null
    createdAt: string
  }>
> {
  const schema = z.object({ attachmentId: z.string().min(1) })
  const parsed = schema.safeParse(rawInput)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'inválido')
  }
  const att = await loadAttachmentForGate(parsed.data.attachmentId)
  await requireProjectAccess(att.task.projectId)

  const rows = await prisma.attachmentVersion.findMany({
    where: { attachmentId: parsed.data.attachmentId },
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: [{ version: 'desc' }],
  })
  return rows.map((r) => ({
    id: r.id,
    attachmentId: r.attachmentId,
    version: r.version,
    storagePath: r.storagePath,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    uploadedById: r.uploadedById,
    uploadedByName: r.uploadedBy?.name ?? null,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }))
}
