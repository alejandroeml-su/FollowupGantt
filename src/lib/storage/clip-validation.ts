/**
 * Wave R4 · US-7.3 · Clips de video — constantes/types/validators puros.
 *
 * Archivo NO marcado `'use server'`: contiene constantes y funciones síncronas
 * que se re-exportan también desde Client Components (`ClipRecorder`,
 * `ClipPlayer`). El módulo equivalente para los `Attachment` normales vive
 * en `src/lib/storage/attachment-validation.ts` — mismo patrón.
 */

// ─── Constantes ───────────────────────────────────────────────────

/**
 * Tope de tamaño por clip. Default 100 MB (alineado con el bucket Supabase).
 * Configurable vía env var `CLIP_MAX_SIZE_MB`. Si el blob excede →
 * `[CLIP_TOO_LARGE]` antes de subir, para no consumir red/storage.
 */
export const CLIP_MAX_SIZE_MB_DEFAULT = 100

/**
 * Duración máxima recomendada (segundos). La UI muestra warning al pasarse
 * pero NO bloquea — clips largos de demo o capacitación son válidos. El
 * cap real lo impone el tamaño del blob (`CLIP_MAX_SIZE_MB`).
 */
export const CLIP_MAX_DURATION_SEC_DEFAULT = 300 // 5 min

/**
 * Mime types aceptados para el blob principal. `video/webm` es el codec
 * que produce MediaRecorder en Chrome/Firefox/Edge; `video/mp4` lo
 * mantenemos como fallback para Safari macOS ≥ 14 (sin soporte webm).
 */
export const ALLOWED_CLIP_MIME = ['video/webm', 'video/mp4'] as const

/**
 * Mime types aceptados para el thumbnail (primer frame). JPEG es el default
 * que produce `canvas.toBlob('image/jpeg', 0.85)`; PNG queda como fallback.
 */
export const ALLOWED_THUMBNAIL_MIME = ['image/jpeg', 'image/png'] as const

/** Nombre del bucket Supabase dedicado a clips. */
export const CLIPS_BUCKET = 'clips'

// ─── Lectura de env ───────────────────────────────────────────────

/**
 * Convierte `CLIP_MAX_SIZE_MB` a bytes. Cae al default si la env var no
 * está set o es inválida. Centralizada aquí para que tanto el server
 * action como el componente recorder usen la misma fuente.
 */
export function clipMaxBytes(): number {
  const envRaw = process.env.CLIP_MAX_SIZE_MB
  const mb = envRaw ? Number.parseInt(envRaw, 10) : CLIP_MAX_SIZE_MB_DEFAULT
  const safe =
    Number.isFinite(mb) && mb > 0 ? mb : CLIP_MAX_SIZE_MB_DEFAULT
  return safe * 1024 * 1024
}

/**
 * Lee la duración recomendada (segundos) desde env. Sólo se usa para
 * mostrar warning en UI; ningún path lo enforce como hard limit.
 */
export function clipMaxDurationSec(): number {
  const envRaw = process.env.CLIP_MAX_DURATION_SEC
  const s = envRaw ? Number.parseInt(envRaw, 10) : CLIP_MAX_DURATION_SEC_DEFAULT
  return Number.isFinite(s) && s > 0 ? s : CLIP_MAX_DURATION_SEC_DEFAULT
}

// ─── Errores tipados ──────────────────────────────────────────────

export type ClipErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CLIP'
  | 'CLIP_TOO_LARGE'
  | 'UPLOAD_FAILED'
  | 'TASK_NOT_FOUND'
  | 'COMMENT_NOT_FOUND'
  | 'CLIP_NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'STORAGE_NOT_CONFIGURED'

// ─── Tipos públicos ───────────────────────────────────────────────

export interface ClipDTO {
  id: string
  taskId: string | null
  commentId: string | null
  authorId: string | null
  /** URL pública del video (bucket `clips` es public-read). */
  videoUrl: string
  /** URL pública del thumbnail; null si no se generó. */
  thumbnailUrl: string | null
  durationSec: number
  sizeBytes: number
  mimeType: string
  createdAt: string
}

// ─── Validators puros ─────────────────────────────────────────────

/**
 * Valida que el mime del clip esté en whitelist. Acepta `video/webm` y
 * sus variantes con codec (`video/webm; codecs="vp9,opus"`).
 */
export function isAllowedClipMime(mime: string): boolean {
  if (!mime) return false
  // El mime suele venir como `video/webm; codecs="..."`. Comparamos solo
  // el "type/subtype" base.
  const base = mime.split(';')[0]!.trim().toLowerCase()
  return (ALLOWED_CLIP_MIME as readonly string[]).includes(base)
}

/**
 * Valida el mime del thumbnail. `image/jpeg` o `image/png`.
 */
export function isAllowedThumbnailMime(mime: string): boolean {
  if (!mime) return false
  const base = mime.split(';')[0]!.trim().toLowerCase()
  return (ALLOWED_THUMBNAIL_MIME as readonly string[]).includes(base)
}

/**
 * Feature detection client-side: ¿este browser soporta grabación de pantalla?
 * Usado por `ClipRecorder` para mostrar/ocultar el botón "Grabar clip" y
 * por la sección del TaskDrawer.
 *
 * Devuelve `false` en server (SSR) — el botón se renderiza condicionalmente
 * tras hidratación.
 */
export function canRecordClips(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof window === 'undefined') return false
  // `mediaDevices.getDisplayMedia` es la primary API; MediaRecorder cubre
  // la persistencia. Si falta cualquiera de las dos, no podemos grabar.
  const md = (navigator as Navigator).mediaDevices as MediaDevices | undefined
  if (!md || typeof md.getDisplayMedia !== 'function') return false
  // `MediaRecorder` no está en el lib.dom de algunos targets antiguos;
  // accedemos vía cast para no romper tsc en server build.
  const w = window as unknown as { MediaRecorder?: typeof MediaRecorder }
  if (typeof w.MediaRecorder === 'undefined') return false
  return true
}

/**
 * Devuelve el mime preferido soportado por `MediaRecorder` en el browser
 * actual. Orden: vp9+opus → vp8+opus → webm sin codec → mp4 (Safari).
 * Devuelve null si ninguno está soportado.
 */
export function pickPreferredClipMime(): string | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { MediaRecorder?: typeof MediaRecorder }
  const MR = w.MediaRecorder
  if (!MR || typeof MR.isTypeSupported !== 'function') return null
  const candidates = [
    'video/webm; codecs="vp9,opus"',
    'video/webm; codecs="vp8,opus"',
    'video/webm',
    'video/mp4',
  ]
  for (const c of candidates) {
    try {
      if (MR.isTypeSupported(c)) return c
    } catch {
      // Algunos navegadores throw si el argumento no es válido.
    }
  }
  return null
}
