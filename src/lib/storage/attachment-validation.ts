/**
 * Wave P8 · Equipo P8-4 — constantes/types/validators puros para attachments.
 *
 * Archivo NO marcado `'use server'`: contiene constantes y funciones síncronas
 * que no pueden vivir en `upload-attachment.ts` (que sí es Server Action y
 * sólo permite exports `async`). Re-exportable desde Client Components.
 */

// ─── Constantes ───────────────────────────────────────────────────

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

// ─── Errores tipados ──────────────────────────────────────────────

export type UploadAttachmentErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'UPLOAD_FAILED'
  | 'TASK_NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'

// ─── Tipos públicos ───────────────────────────────────────────────

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

// ─── Validators puros ─────────────────────────────────────────────

/**
 * Sanea el filename preservando sólo `[a-zA-Z0-9._-]`. Espacios → `_`.
 * Cualquier otro carácter (acentos, símbolos, paths) → `_`. Si tras
 * sanear queda vacío o solo extensión, devuelve `archivo.bin`.
 *
 * Importante: previene path traversal (`..`, `/`, `\`) en el storage path.
 */
export function sanitizeFilename(input: string): string {
  if (!input) return 'archivo.bin'
  const base = input.split(/[\\/]/).pop() ?? input
  const cleaned = base
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
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
