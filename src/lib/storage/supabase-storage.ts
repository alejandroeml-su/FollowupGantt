import 'server-only'

/**
 * Wave P8 · Equipo P8-4 — Wrapper sobre Supabase Storage.
 *
 * Encapsula `supabase.storage.from('attachments')` para que el resto del
 * código no dependa directamente del SDK ni del nombre del bucket. Métodos:
 *   - `uploadAttachment(blob, path)` → sube un blob al bucket. Lanza
 *     `[UPLOAD_FAILED]` si el SDK falla.
 *   - `getSignedUrlFor(path, expiresIn)` → URL temporal (default 1h).
 *   - `removeAttachment(path)` → borra el objeto. Idempotente: tolera 404.
 *   - `__getStorageClient()` → exposed for tests; lazy-init.
 *
 * Diseño:
 *   - Usa `SUPABASE_SERVICE_ROLE_KEY` cuando está disponible (operaciones
 *     server-only, bypassa RLS de `storage.objects` cuando aplique). Cuando
 *     no esté configurada, cae al `NEXT_PUBLIC_SUPABASE_ANON_KEY` + RLS
 *     policy de `authenticated` (ver docs/operations/supabase-storage.md).
 *   - Singleton lazy: el cliente se crea on-demand para evitar fallar al
 *     bundle build cuando las env vars no están seteadas (CI sin secrets).
 *   - Errores tipados `[STORAGE_NOT_CONFIGURED]`, `[UPLOAD_FAILED]`,
 *     `[SIGN_FAILED]`, `[REMOVE_FAILED]`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const ATTACHMENTS_BUCKET = 'attachments'

export type StorageErrorCode =
  | 'STORAGE_NOT_CONFIGURED'
  | 'UPLOAD_FAILED'
  | 'SIGN_FAILED'
  | 'REMOVE_FAILED'

function storageError(code: StorageErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

let storageSingleton: SupabaseClient | null | undefined

/**
 * Lee credenciales para Storage. Prefiere `SUPABASE_SERVICE_ROLE_KEY` (server
 * actions con bypass de RLS) y cae a `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 */
function readStorageEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return { url, key }
}

/**
 * Devuelve el cliente Supabase para Storage. Lazy + singleton. Devuelve
 * `null` si las env vars no están configuradas (test/CI sin secrets).
 */
export function __getStorageClient(): SupabaseClient | null {
  if (storageSingleton !== undefined) return storageSingleton
  const env = readStorageEnv()
  if (!env) {
    storageSingleton = null
    return null
  }
  storageSingleton = createClient(env.url, env.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return storageSingleton
}

/** Reset del singleton — exclusivo para tests. */
export function __resetStorageClientForTests(): void {
  storageSingleton = undefined
}

function requireClient(): SupabaseClient {
  const client = __getStorageClient()
  if (!client) {
    storageError(
      'STORAGE_NOT_CONFIGURED',
      'Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY (o NEXT_PUBLIC_SUPABASE_ANON_KEY) — configurar antes de usar Storage',
    )
  }
  return client
}

/**
 * Sube un blob al bucket `attachments` con `upsert=false` (no sobrescribe).
 * Lanza `[UPLOAD_FAILED]` si el SDK reporta error. Devuelve el `path`.
 *
 * `contentType` se guarda en metadata del objeto para que la signed URL
 * sirva con el header correcto.
 */
export async function uploadAttachment(
  blob: Blob | ArrayBuffer | Buffer,
  path: string,
  contentType: string,
): Promise<{ path: string }> {
  const client = requireClient()
  const { data, error } = await client.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, blob, {
      contentType,
      upsert: false,
      cacheControl: '3600',
    })
  if (error || !data) {
    storageError('UPLOAD_FAILED', error?.message ?? 'Error desconocido al subir')
  }
  return { path: data.path }
}

/**
 * Genera una signed URL temporal con expiración (default 1h). Lanza
 * `[SIGN_FAILED]` si el SDK falla.
 */
export async function getSignedUrlFor(
  path: string,
  expiresInSeconds = 3600,
): Promise<{ signedUrl: string; expiresAt: Date }> {
  const client = requireClient()
  const { data, error } = await client.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds)
  if (error || !data?.signedUrl) {
    storageError(
      'SIGN_FAILED',
      error?.message ?? 'No se pudo generar la signed URL',
    )
  }
  return {
    signedUrl: data.signedUrl,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  }
}

/**
 * Borra un objeto del bucket. Idempotente: si el objeto no existía, no
 * lanza. Sólo lanza `[REMOVE_FAILED]` para errores reales del SDK.
 */
export async function removeAttachment(path: string): Promise<void> {
  const client = requireClient()
  const { error } = await client.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([path])
  if (error) {
    // El SDK suele responder OK aún si el objeto no existía. Cualquier
    // error real (red, perms) sí debe propagarse.
    storageError('REMOVE_FAILED', error.message)
  }
}
