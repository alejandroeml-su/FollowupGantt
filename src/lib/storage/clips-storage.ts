import 'server-only'

/**
 * Wave R4 · US-7.3 · Clips de video — wrapper sobre Supabase Storage para el
 * bucket `clips`.
 *
 * Diseño paralelo a `supabase-storage.ts` (bucket `attachments`) pero con
 * algunas diferencias:
 *   - Bucket público → para servir `<video>` y `<img>` sin signed URL por
 *     cada render (los clips no son sensibles; el RBAC se hace en el server
 *     action de listado vía `requireProjectAccess`).
 *   - `getPublicUrl` en lugar de `createSignedUrl`.
 *
 * Errores tipados `[STORAGE_NOT_CONFIGURED]`, `[UPLOAD_FAILED]`,
 * `[REMOVE_FAILED]`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CLIPS_BUCKET } from './clip-validation'

type ClipStorageErrorCode =
  | 'STORAGE_NOT_CONFIGURED'
  | 'UPLOAD_FAILED'
  | 'REMOVE_FAILED'

function storageError(code: ClipStorageErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

let clipsSingleton: SupabaseClient | null | undefined

function readEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return { url, key }
}

/**
 * Devuelve el cliente Supabase para el bucket `clips`. Lazy + singleton.
 * Devuelve `null` si las env vars no están configuradas — el caller decide
 * si lanzar `[STORAGE_NOT_CONFIGURED]` o degradar.
 */
export function __getClipsClient(): SupabaseClient | null {
  if (clipsSingleton !== undefined) return clipsSingleton
  const env = readEnv()
  if (!env) {
    clipsSingleton = null
    return null
  }
  clipsSingleton = createClient(env.url, env.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return clipsSingleton
}

/** Reset del singleton — exclusivo para tests. */
export function __resetClipsClientForTests(): void {
  clipsSingleton = undefined
}

function requireClient(): SupabaseClient {
  const client = __getClipsClient()
  if (!client) {
    storageError(
      'STORAGE_NOT_CONFIGURED',
      'Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY — ver docs/features/clips-storage-setup.md',
    )
  }
  return client
}

/**
 * Sube un blob al bucket `clips`. Permite upsert (default false) — útil
 * para `regenerateThumbnail` que sobreescribe el `thumb.jpg`.
 */
export async function uploadClipBlob(
  blob: Blob | ArrayBuffer | Buffer,
  path: string,
  contentType: string,
  options: { upsert?: boolean } = {},
): Promise<{ path: string }> {
  const client = requireClient()
  const { data, error } = await client.storage
    .from(CLIPS_BUCKET)
    .upload(path, blob, {
      contentType,
      upsert: options.upsert ?? false,
      cacheControl: '3600',
    })
  if (error || !data) {
    storageError('UPLOAD_FAILED', error?.message ?? 'Error desconocido al subir clip')
  }
  return { path: data.path }
}

/**
 * Devuelve la URL pública (no firmada) de un path. El bucket `clips` se
 * crea con `public=true` (ver docs/features/clips-storage-setup.md). Si
 * fuera necesario revocar acceso público en el futuro, este helper se
 * actualiza para emitir signed URL con TTL.
 */
export function getClipPublicUrl(path: string): string {
  const client = requireClient()
  const { data } = client.storage.from(CLIPS_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Borra uno o más objetos del bucket. Idempotente: si el objeto no existe,
 * Supabase devuelve OK; sólo errores reales del SDK escalan.
 */
export async function removeClipObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const client = requireClient()
  const { error } = await client.storage.from(CLIPS_BUCKET).remove(paths)
  if (error) {
    storageError('REMOVE_FAILED', error.message)
  }
}
