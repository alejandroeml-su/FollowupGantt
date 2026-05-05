'use server'

/**
 * Wave P8 · Equipo P8-4 — Server action para obtener signed URL temporal.
 *
 * Recibe un `attachmentId`, valida acceso al proyecto dueño de la tarea y
 * retorna una URL firmada con TTL configurable (default 1h). El cliente
 * usa esta URL en `<img src>`, `<iframe src>` o `<a href download>`.
 *
 * Convenciones:
 *   - Errores tipados `[INVALID_INPUT]`, `[ATTACHMENT_NOT_FOUND]`,
 *     `[FORBIDDEN]`, `[STORAGE_NOT_CONFIGURED]`, `[SIGN_FAILED]`.
 *   - `requireProjectAccess(projectId)` resolviendo el `projectId` desde la
 *     `Task` dueña del attachment.
 *
 * Decisiones autónomas:
 *   D-S1: TTL 1h por default — suficiente para que el navegador cargue
 *         imágenes/PDF y permita un download tras click sin re-pedir. La
 *         UI puede solicitar `expiresIn=300` (5min) para descargas one-shot.
 *   D-S2: Si el `Attachment.storagePath` es null (legacy con `url` directo),
 *         devolvemos `{ signedUrl: row.url, isLegacy: true }` para que el
 *         cliente pueda mostrar el archivo viejo sin extra-roundtrip.
 */

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { getSignedUrlFor } from '@/lib/storage/supabase-storage'

// ─────────────────────────── Errores tipados ──────────────────────────

export type GetSignedUrlErrorCode =
  | 'INVALID_INPUT'
  | 'ATTACHMENT_NOT_FOUND'
  | 'FORBIDDEN'
  | 'STORAGE_NOT_CONFIGURED'
  | 'SIGN_FAILED'

function actionError(code: GetSignedUrlErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schema ────────────────────────────────

const InputSchema = z.object({
  attachmentId: z.string().min(1, 'attachmentId es obligatorio'),
  expiresIn: z.number().int().min(30).max(86400).optional(),
})

// ─────────────────────────── Tipo público ──────────────────────────

export interface SignedUrlResult {
  attachmentId: string
  signedUrl: string
  /** ISO string de expiración (Date.now + expiresIn). */
  expiresAt: string
  /** Mime type registrado en la fila. */
  mimeType: string | null
  /** Filename original (sanitizado). */
  filename: string
  /**
   * `true` si el attachment usa el campo `url` legacy (no Supabase Storage).
   * En ese caso `signedUrl` es la URL directa registrada y no expira.
   */
  isLegacy: boolean
}

// ─────────────────────────── Server action ────────────────────────────

export async function getSignedUrl(
  rawInput: z.infer<typeof InputSchema>,
): Promise<SignedUrlResult> {
  const parsed = InputSchema.safeParse(rawInput)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)
  const { attachmentId, expiresIn } = parsed.data

  // ─── Cargar attachment con projectId via task ──────────────────
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      filename: true,
      url: true,
      storagePath: true,
      mimeType: true,
      mimetype: true, // legacy
      task: { select: { id: true, projectId: true } },
    },
  })
  if (!attachment) {
    actionError('ATTACHMENT_NOT_FOUND', `Attachment ${attachmentId} no existe`)
  }

  await requireProjectAccess(attachment.task.projectId)

  const effectiveMime = attachment.mimeType ?? attachment.mimetype ?? null

  // ─── Legacy fallback: usar url directa ─────────────────────────
  if (!attachment.storagePath) {
    if (!attachment.url) {
      actionError(
        'ATTACHMENT_NOT_FOUND',
        'El attachment no tiene storagePath ni url legacy',
      )
    }
    return {
      attachmentId: attachment.id,
      signedUrl: attachment.url,
      // Para legacy "no expira" — devolvemos timestamp lejano.
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      mimeType: effectiveMime,
      filename: attachment.filename,
      isLegacy: true,
    }
  }

  // ─── Generar signed URL via SDK ────────────────────────────────
  let signed: { signedUrl: string; expiresAt: Date }
  try {
    signed = await getSignedUrlFor(attachment.storagePath, expiresIn ?? 3600)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    if (msg.includes('[STORAGE_NOT_CONFIGURED]')) {
      actionError('STORAGE_NOT_CONFIGURED', msg)
    }
    actionError('SIGN_FAILED', msg)
  }

  return {
    attachmentId: attachment.id,
    signedUrl: signed.signedUrl,
    expiresAt: signed.expiresAt.toISOString(),
    mimeType: effectiveMime,
    filename: attachment.filename,
    isLegacy: false,
  }
}
