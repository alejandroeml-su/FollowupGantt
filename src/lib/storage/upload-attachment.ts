'use server'

/**
 * Wave P8 · Equipo P8-4 — Server action de upload de Attachments.
 *
 * Recibe un `FormData` con `taskId` y un blob `file`. Valida mime + tamaño,
 * sube a Supabase Storage en `{userId}/{uuid}-{sanitized-filename}` y crea
 * la fila `Attachment` con `storagePath`, `mimeType`, `sizeBytes`.
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[INVALID_FILE]`, `[FILE_TOO_LARGE]`, `[UPLOAD_FAILED]`,
 *     `[TASK_NOT_FOUND]`, `[FORBIDDEN]`, `[INVALID_INPUT]`, `[UNAUTHORIZED]`.
 *   - `requireProjectAccess(projectId)` resolviendo el `projectId` desde la
 *     `Task` dueña.
 *   - `revalidatePath` después de mutar.
 *   - Validación con zod.
 *
 * Decisiones autónomas:
 *   D-A1: Whitelist mime estricta — image/*, application/pdf, text/*,
 *         application/zip. Cualquier otro mime se rechaza con `[INVALID_FILE]`.
 *         No usamos magic-byte detection (depende del header `file.type`,
 *         con riesgo de spoofing); para seguridad real adicionar antivirus
 *         downstream (deuda registrada).
 *   D-A2: Cap de 25MB hard. Subir archivos más grandes lanza `[FILE_TOO_LARGE]`
 *         antes del upload (no consumimos red/storage si excede).
 *   D-A3: El path siempre incluye el `userId` como primer segmento — la RLS
 *         policy de `storage.objects` valida que `(storage.foldername(name))[1]
 *         = auth.uid()::text`. Como nuestro auth es propio (cookies), usamos
 *         service role en server, pero el patrón se mantiene para que la
 *         policy proteja accesos directos a la API.
 *   D-A4: El nombre se sanitiza preservando solo `[a-zA-Z0-9._-]`. Espacios
 *         → guion bajo. Si tras sanear queda vacío, `archivo.bin`.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import * as crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { uploadAttachment as storageUpload } from '@/lib/storage/supabase-storage'

// ─────────────────────────── Constantes ───────────────────────────

/**
 * Tope de tamaño por archivo. Vercel y la mayoría de proxies aceptan body
 * hasta ~50MB; 25MB nos deja margen y reduce timeouts. Para subir mayor
 * usar pre-signed upload directo desde browser (deuda registrada).
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB

/**
 * Whitelist de mime types aceptados. Si el archivo no matchea EXACTO o
 * por prefijo (`image/`, `text/`), se rechaza.
 */
export const ALLOWED_MIME_PREFIXES = ['image/', 'text/'] as const
export const ALLOWED_MIME_EXACT = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
] as const

// ─────────────────────────── Errores tipados ──────────────────────────

export type UploadAttachmentErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'UPLOAD_FAILED'
  | 'TASK_NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'

function actionError(code: UploadAttachmentErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Helpers ────────────────────────────────

/**
 * Sanea el filename preservando sólo `[a-zA-Z0-9._-]`. Espacios → `_`.
 * Cualquier otro carácter (acentos, símbolos, paths) → `_`. Si tras
 * sanear queda vacío o solo extensión, devuelve `archivo.bin`.
 *
 * Importante: previene path traversal (`..`, `/`, `\`) en el storage path.
 */
export function sanitizeFilename(input: string): string {
  if (!input) return 'archivo.bin'
  // Quitar segmentos de path antes de sanear (toma solo el "basename").
  const base = input.split(/[\\/]/).pop() ?? input
  const cleaned = base
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
  // Si quedó vacío o solo separadores, fallback.
  if (!cleaned || /^[._-]+$/.test(cleaned)) return 'archivo.bin'
  return cleaned
}

/**
 * Valida que el mime type esté en whitelist. Acepta prefijos (`image/png`,
 * `text/csv`) o exactos (`application/pdf`).
 */
export function isAllowedMime(mime: string): boolean {
  if (!mime) return false
  for (const prefix of ALLOWED_MIME_PREFIXES) {
    if (mime.startsWith(prefix)) return true
  }
  return (ALLOWED_MIME_EXACT as readonly string[]).includes(mime)
}

// ─────────────────────────── Schema ────────────────────────────────

const TaskIdSchema = z.string().min(1, 'taskId es obligatorio')

// ─────────────────────────── Tipos públicos ────────────────────────────

export interface AttachmentDTO {
  id: string
  taskId: string
  filename: string
  storagePath: string | null
  mimeType: string | null
  sizeBytes: number | null
  uploadedById: string | null
  uploadedAt: string
  createdAt: string
}

function toDTO(row: {
  id: string
  taskId: string
  filename: string
  storagePath: string | null
  mimeType: string | null
  sizeBytes: number | null
  uploadedById: string | null
  uploadedAt: Date
  createdAt: Date
}): AttachmentDTO {
  return {
    id: row.id,
    taskId: row.taskId,
    filename: row.filename,
    storagePath: row.storagePath,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedById: row.uploadedById,
    uploadedAt: row.uploadedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

// ─────────────────────────── Server action ────────────────────────────

/**
 * Sube un archivo a Supabase Storage y crea la fila `Attachment` vinculada
 * a la tarea. Espera un `FormData` con:
 *   - `taskId`: string (obligatorio).
 *   - `file`: Blob/File (obligatorio).
 *
 * Retorna el DTO del attachment creado. Para mostrarlo, el cliente debe
 * llamar `getSignedUrl(attachmentId)` para obtener URL temporal.
 */
export async function uploadAttachmentAction(
  formData: FormData,
): Promise<AttachmentDTO> {
  // ─── Parse del FormData ─────────────────────────────────────────
  const rawTaskId = formData.get('taskId')
  const file = formData.get('file')

  const parsedTaskId = TaskIdSchema.safeParse(rawTaskId)
  if (!parsedTaskId.success) {
    actionError('INVALID_INPUT', parsedTaskId.error.message)
  }
  const taskId = parsedTaskId.data

  if (!file || typeof file === 'string') {
    actionError('INVALID_FILE', 'No se recibió un archivo válido')
  }
  // En runtime Next.js (Edge / Node), `File` extiende `Blob`. En tests con
  // `polyfill-formdata` también es `Blob`. Validamos por shape mínimo.
  const blob = file as Blob & { name?: string; type?: string }
  const filename = sanitizeFilename(
    typeof blob.name === 'string' && blob.name ? blob.name : 'archivo.bin',
  )
  const mimeType = (typeof blob.type === 'string' && blob.type) || 'application/octet-stream'
  const sizeBytes = blob.size ?? 0

  // ─── Validaciones ───────────────────────────────────────────────
  if (sizeBytes <= 0) {
    actionError('INVALID_FILE', 'El archivo está vacío')
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    actionError(
      'FILE_TOO_LARGE',
      `El archivo supera el máximo de ${MAX_FILE_BYTES} bytes (recibido: ${sizeBytes})`,
    )
  }
  if (!isAllowedMime(mimeType)) {
    actionError(
      'INVALID_FILE',
      `Mime type "${mimeType}" no permitido. Usa imágenes, PDF, texto o ZIP.`,
    )
  }

  // ─── Auth ───────────────────────────────────────────────────────
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true },
  })
  if (!task) actionError('TASK_NOT_FOUND', `Tarea ${taskId} no encontrada`)
  await requireProjectAccess(task.projectId)
  const user = await getCurrentUser()
  if (!user) actionError('UNAUTHORIZED', 'Sesión requerida')

  // ─── Path en bucket ─────────────────────────────────────────────
  // `{userId}/{uuid}-{filename}` — el primer segmento es el `userId`
  // para que la RLS policy de `storage.objects` lo valide.
  const objectId = crypto.randomUUID()
  const storagePath = `${user.id}/${objectId}-${filename}`

  // ─── Upload ─────────────────────────────────────────────────────
  try {
    await storageUpload(blob, storagePath, mimeType)
  } catch (e) {
    // Si la upload falla, propagamos como `[UPLOAD_FAILED]` con el
    // detalle del SDK para diagnóstico. La fila NO se crea.
    const detail = e instanceof Error ? e.message : 'Error desconocido'
    actionError('UPLOAD_FAILED', detail)
  }

  // ─── Persistencia ───────────────────────────────────────────────
  const created = await prisma.attachment.create({
    data: {
      taskId: task.id,
      filename,
      storagePath,
      mimeType,
      sizeBytes,
      uploadedById: user.id,
      // `userId` legacy se persiste en paralelo durante migración.
      userId: user.id,
      // `url` legacy queda null — el flujo nuevo usa signed URL bajo demanda.
    },
    select: {
      id: true,
      taskId: true,
      filename: true,
      storagePath: true,
      mimeType: true,
      sizeBytes: true,
      uploadedById: true,
      uploadedAt: true,
      createdAt: true,
    },
  })

  // ─── Revalidate ─────────────────────────────────────────────────
  revalidatePath('/list')
  revalidatePath('/gantt')
  revalidatePath('/kanban')
  revalidatePath(`/tasks/${task.id}`)

  return toDTO(created)
}
