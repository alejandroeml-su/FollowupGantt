/**
 * Wave P17-B (API pública v2) · Autenticación + middleware de scopes/rate-limit.
 *
 * Flujo:
 *   1. Header `Authorization: Bearer sk_<prefix>_<secret>`.
 *   2. Lookup en BD por `prefix` (indexed) → verifica `hashedKey === sha256(plain)`.
 *   3. Verifica revocación + expiración.
 *   4. Verifica scope requerido (`hasV2Scope`).
 *   5. Rate-limit por keyId (60/min · 1000/hora).
 *
 * Errores tipados (mapeados a HTTP por `apiV2Error`):
 *   - `[INVALID_KEY]`        → 401
 *   - `[INSUFFICIENT_SCOPE]` → 403
 *   - `[RATE_LIMITED]`       → 429
 *
 * Persiste `lastUsedAt` fire-and-forget (igual que v1 ApiToken).
 */

import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { hasV2Scope, type V2Scope } from '@/lib/api/v2-scopes'
import { checkAndConsume, type RateLimitResult } from '@/lib/api/v2-rate-limit'

// Formato canónico del key plano: `sk_<prefix8>_<secret43>`. El prefix se
// guarda separado en BD para indexar el lookup; el secret tiene 32 bytes
// (256 bits) en base64url.
const KEY_PREFIX = 'sk_'
const PREFIX_LEN = 8
const SECRET_BYTES = 32

export interface AuthenticatedApiKey {
  id: string
  workspaceId: string
  scopes: string[]
  expiresAt: Date | null
}

export interface AuthSuccess {
  ok: true
  apiKey: AuthenticatedApiKey
  rateLimit: RateLimitResult
}

export interface AuthFailure {
  ok: false
  code: 'INVALID_KEY' | 'INSUFFICIENT_SCOPE' | 'RATE_LIMITED'
  message: string
  retryAfterMs?: number
}

export type AuthResult = AuthSuccess | AuthFailure

/**
 * Genera un key plano + su hash + el prefix. Solo se invoca desde la server
 * action `createApiKey`. El plaintext NO se persiste.
 */
export function generateApiKey(): {
  plaintext: string
  hashedKey: string
  prefix: string
} {
  // Prefix corto para indexing — usamos hex (URL-safe sin padding).
  const prefix = randomBytes(Math.ceil(PREFIX_LEN / 2))
    .toString('hex')
    .slice(0, PREFIX_LEN)
  const secret = randomBytes(SECRET_BYTES).toString('base64url')
  const plaintext = `${KEY_PREFIX}${prefix}_${secret}`
  const hashedKey = sha256Hex(plaintext)
  return { plaintext, hashedKey, prefix }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Extrae prefix + secret del key plano. Devuelve `null` si el formato
 * no encaja (no lanza para que el caller pueda devolver 401 limpio).
 */
export function parseApiKey(plain: string): { prefix: string; secret: string } | null {
  if (typeof plain !== 'string' || !plain.startsWith(KEY_PREFIX)) return null
  const body = plain.slice(KEY_PREFIX.length)
  const idx = body.indexOf('_')
  if (idx < 0) return null
  const prefix = body.slice(0, idx)
  const secret = body.slice(idx + 1)
  if (prefix.length !== PREFIX_LEN) return null
  if (secret.length === 0) return null
  return { prefix, secret }
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null
  const m = /^Bearer\s+(\S+)\s*$/.exec(authHeader)
  if (!m) return null
  return m[1]
}

/**
 * Verifica el Bearer contra BD y aplica scope + rate-limit. Devuelve
 * un objeto discriminated-union para evitar excepciones en el handler.
 */
export async function authenticateV2Request(
  request: NextRequest | Request,
  requiredScope: V2Scope,
): Promise<AuthResult> {
  const header =
    request.headers.get('authorization') ?? request.headers.get('Authorization')
  const plain = extractBearer(header)
  if (!plain) {
    return {
      ok: false,
      code: 'INVALID_KEY',
      message: 'Header Authorization Bearer requerido',
    }
  }

  const parsed = parseApiKey(plain)
  if (!parsed) {
    return {
      ok: false,
      code: 'INVALID_KEY',
      message: 'Formato de key inválido (esperado: sk_<prefix>_<secret>)',
    }
  }

  // Lookup por prefix (indexed) — hay teóricamente colisión 1/2^32 pero
  // si llegara a haber, comparamos cada hash timing-safe.
  const candidates = await prisma.apiKey.findMany({
    where: { prefix: parsed.prefix, revokedAt: null },
    select: {
      id: true,
      hashedKey: true,
      scopes: true,
      expiresAt: true,
      workspaceId: true,
    },
  })
  if (candidates.length === 0) {
    return {
      ok: false,
      code: 'INVALID_KEY',
      message: 'API key no encontrada o revocada',
    }
  }

  const incomingHash = sha256Hex(plain)
  let matched: (typeof candidates)[number] | null = null
  for (const cand of candidates) {
    try {
      const a = Buffer.from(cand.hashedKey)
      const b = Buffer.from(incomingHash)
      if (a.length === b.length && timingSafeEqual(a, b)) {
        matched = cand
        break
      }
    } catch {
      // continúa
    }
  }
  if (!matched) {
    return { ok: false, code: 'INVALID_KEY', message: 'API key inválida' }
  }
  if (matched.expiresAt && matched.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'INVALID_KEY', message: 'API key expirada' }
  }

  // Scope check
  const scopes = Array.isArray(matched.scopes) ? matched.scopes : []
  if (!hasV2Scope(scopes, requiredScope)) {
    return {
      ok: false,
      code: 'INSUFFICIENT_SCOPE',
      message: `API key sin scope requerido: ${requiredScope}`,
    }
  }

  // Rate limit check
  const rateLimit = checkAndConsume(matched.id)
  if (!rateLimit.allowed) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `Rate limit excedido (${rateLimit.scope}). Reintenta en ${Math.ceil(
        rateLimit.retryAfterMs / 1000,
      )}s`,
      retryAfterMs: rateLimit.retryAfterMs,
    }
  }

  // Fire-and-forget lastUsedAt
  void prisma.apiKey
    .update({ where: { id: matched.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return {
    ok: true,
    apiKey: {
      id: matched.id,
      workspaceId: matched.workspaceId,
      scopes,
      expiresAt: matched.expiresAt,
    },
    rateLimit,
  }
}
