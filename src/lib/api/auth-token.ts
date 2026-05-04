/**
 * API REST v1 (Ola P4 · Equipo P4-2) — autenticación por token Bearer.
 *
 * Estrategia:
 *   - El token claro tiene formato `fg_<base64url(32 bytes)>`. Lo emite el
 *     server action `createApiToken` y se muestra UNA SOLA VEZ al usuario.
 *   - En BD persistimos solo `tokenHash = sha256(token)`. Esto evita que un
 *     dump de DB exponga credenciales válidas.
 *   - El `prefix` (primeros 12 chars del token, incluido `fg_`) se guarda
 *     en claro como hint visual ("fg_aBcD…") para que el usuario reconozca
 *     cuál revocar sin leer el hash.
 *
 * Performance:
 *   - El lookup en BD es O(1) gracias al unique index sobre `tokenHash`.
 *   - `lastUsedAt` se actualiza fire-and-forget: no bloqueamos la request
 *     y silenciamos errores (el dato es informativo).
 *
 * Errores tipados (consistente con el resto del repo):
 *   - `[UNAUTHORIZED]`  → header ausente, formato inválido, hash no encontrado,
 *                         token revocado o expirado.
 *   - `[FORBIDDEN]`     → token válido pero sin scope requerido.
 *
 * El handler de `route.ts` mapea estos errores al `Response` correspondiente
 * vía `errorResponseFromException`.
 */

import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import prisma from '@/lib/prisma'
import { hasScope, type Scope } from '@/lib/api/scopes'

const TOKEN_BYTES = 32 // 256 bits → 43 chars base64url
const TOKEN_PREFIX = 'fg_'
const PREFIX_DISPLAY_LEN = 12 // "fg_" + 9 chars del cuerpo

export interface AuthenticatedToken {
  tokenId: string
  userId: string
  scopes: string[]
  expiresAt: Date | null
}

/**
 * Genera un token plano nuevo + su hash para persistir + el prefijo display.
 * Se invoca SOLO desde la server action `createApiToken`. El plaintext NO
 * se persiste; el caller lo devuelve al cliente una sola vez.
 */
export function generateApiToken(): {
  plaintext: string
  tokenHash: string
  prefix: string
} {
  const body = randomBytes(TOKEN_BYTES).toString('base64url')
  const plaintext = `${TOKEN_PREFIX}${body}`
  const tokenHash = sha256Hex(plaintext)
  const prefix = plaintext.slice(0, PREFIX_DISPLAY_LEN)
  return { plaintext, tokenHash, prefix }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Extrae el bearer token del header `Authorization`. Devuelve null si el
 * header está ausente o el formato no es `Bearer <token>`.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const match = /^Bearer\s+(\S+)\s*$/.exec(authHeader)
  if (!match) return null
  return match[1]
}

/**
 * Valida un token claro: lookup en BD por hash, chequeo de revocación y
 * expiración. Devuelve `AuthenticatedToken` o lanza `[UNAUTHORIZED]`.
 *
 * Side-effect: actualiza `lastUsedAt` fire-and-forget. Si el update falla
 * (BD caída momentáneamente, race), la request continúa exitosa.
 */
export async function authenticateToken(
  plaintext: string,
): Promise<AuthenticatedToken> {
  if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) {
    throw new Error('[UNAUTHORIZED] Token con formato inválido')
  }

  const tokenHash = sha256Hex(plaintext)
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      tokenHash: true,
    },
  })
  if (!row) {
    throw new Error('[UNAUTHORIZED] Token no encontrado')
  }

  // Comparación timing-safe defensiva — el unique index ya nos filtra, pero
  // cualquier capa intermedia podría devolver un row distinto al hash.
  try {
    const a = Buffer.from(row.tokenHash)
    const b = Buffer.from(tokenHash)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('[UNAUTHORIZED] Hash mismatch')
    }
  } catch {
    throw new Error('[UNAUTHORIZED] Hash mismatch')
  }

  if (row.revokedAt) {
    throw new Error('[UNAUTHORIZED] Token revocado')
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new Error('[UNAUTHORIZED] Token expirado')
  }

  // `scopes` se persiste como JSON. Coerce defensivo.
  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : []

  // Fire-and-forget. No await — no queremos que un fallo en update bloquee
  // la request. Los errores se silencian.
  void prisma.apiToken
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {})

  return {
    tokenId: row.id,
    userId: row.userId,
    scopes,
    expiresAt: row.expiresAt,
  }
}

/**
 * Combina extracción + autenticación. Útil dentro de un route handler:
 *
 *   const auth = await authenticateRequest(request)
 *   requireScope(auth, 'projects:read')
 *
 * Lanza `[UNAUTHORIZED]` si falla.
 */
export async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedToken> {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization')
  const plaintext = extractBearerToken(header)
  if (!plaintext) {
    throw new Error('[UNAUTHORIZED] Header Authorization Bearer requerido')
  }
  return authenticateToken(plaintext)
}

/**
 * Lanza `[FORBIDDEN]` si el token no incluye el scope requerido. La función
 * `hasScope` aplica las reglas de implicación (admin > write > read, * = todo).
 */
export function requireScope(auth: AuthenticatedToken, scope: Scope): void {
  if (!hasScope(auth.scopes, scope)) {
    throw new Error(`[FORBIDDEN] Token sin scope requerido: ${scope}`)
  }
}
