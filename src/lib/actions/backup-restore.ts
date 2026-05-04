'use server'

/**
 * P3-3 · Server actions de export/import full de proyecto en ZIP.
 *
 * - `exportProjectFull(projectId)` → genera ZIP con manifest.json y
 *   devuelve `{ filename, mimeType, payloadBase64 }` para que el botón
 *   cliente arme la descarga sin más roundtrips.
 * - `importProjectFull(zipBase64)` → recibe el ZIP en base64, lo valida
 *   (zod + schemaVersion), crea proyecto NUEVO con UUIDs frescos dentro
 *   de `prisma.$transaction` (all-or-nothing) y devuelve
 *   `{ projectId, warnings }`.
 *
 * Convenciones del repo:
 *   - Errores tipados `[CODE] detalle` propagados al cliente.
 *   - `revalidatePath` solo para import (mutación); el export es read-only.
 *   - Auth: cualquier usuario autenticado puede exportar proyectos a los
 *     que tiene acceso (`requireProjectAccess`); cualquier autenticado
 *     puede importar (crea un proyecto nuevo donde queda como manager
 *     futuro vía la asignación que el usuario haga después).
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  exportProjectFullToZip,
  type PrismaLikeForExport,
} from '@/lib/backup/export-project'
import {
  importProjectFromZipBase64,
  type PrismaLikeForImport,
} from '@/lib/backup/import-project'
import { ZIP_SIZE_LIMIT_BYTES, ZIP_SIZE_LIMIT_MB } from '@/lib/backup/manifest-schema'

// ───────────────────────── Tipos públicos ─────────────────────────

export interface ExportFullActionResult {
  ok: boolean
  filename?: string
  mimeType?: string
  payloadBase64?: string
  error?: { code: string; detail: string }
}

export interface ImportFullActionResult {
  ok: boolean
  projectId?: string
  warnings?: string[]
  error?: { code: string; detail: string }
}

// ───────────────────────── Helpers ─────────────────────────

/**
 * Extrae el code (`[NAME]`) del prefijo de un mensaje de error tipado
 * y devuelve `{ code, detail }`. Si no matchea el patrón, devuelve
 * `EXPORT_FAILED`/`IMPORT_FAILED` según el contexto.
 */
function parseTypedError(
  err: unknown,
  fallbackCode: string,
): { code: string; detail: string } {
  const raw = err instanceof Error ? err.message : String(err)
  const match = raw.match(/^\[([A-Z_]+)\]\s*(.*)$/)
  if (match) return { code: match[1], detail: match[2] || raw }
  return { code: fallbackCode, detail: raw }
}

// ───────────────────────── Server actions ─────────────────────────

export async function exportProjectFull(
  projectId: string,
): Promise<ExportFullActionResult> {
  if (!projectId || typeof projectId !== 'string') {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', detail: 'projectId requerido' },
    }
  }
  try {
    await requireProjectAccess(projectId)

    const result = await exportProjectFullToZip(
      prisma as unknown as PrismaLikeForExport,
      projectId,
    )

    if (result.byteLength > ZIP_SIZE_LIMIT_BYTES) {
      return {
        ok: false,
        error: {
          code: 'FILE_TOO_LARGE',
          detail: `el ZIP generado supera ${ZIP_SIZE_LIMIT_MB} MB`,
        },
      }
    }

    return {
      ok: true,
      filename: result.filename,
      mimeType: result.mimeType,
      payloadBase64: result.payloadBase64,
    }
  } catch (err) {
    return { ok: false, error: parseTypedError(err, 'EXPORT_FAILED') }
  }
}

export async function importProjectFull(
  zipBase64: string,
): Promise<ImportFullActionResult> {
  if (!zipBase64 || typeof zipBase64 !== 'string') {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', detail: 'zipBase64 requerido' },
    }
  }

  // Auth básica: cualquier usuario autenticado puede importar (crea un
  // proyecto nuevo). No usamos `requireProjectAccess` porque aún no hay
  // proyecto al cual chequear acceso.
  const user = await getCurrentUser()
  if (!user) {
    return {
      ok: false,
      error: { code: 'UNAUTHORIZED', detail: 'Sesión requerida' },
    }
  }

  try {
    const result = await importProjectFromZipBase64(
      prisma as unknown as PrismaLikeForImport,
      zipBase64,
    )
    revalidatePath('/projects')
    revalidatePath(`/projects/${result.projectId}`)
    return {
      ok: true,
      projectId: result.projectId,
      warnings: result.warnings,
    }
  } catch (err) {
    return { ok: false, error: parseTypedError(err, 'IMPORT_FAILED') }
  }
}
