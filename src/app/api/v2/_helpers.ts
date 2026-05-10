/**
 * Wave P17-B · Helpers compartidos por endpoints v2.
 *
 * Encapsula el patrón:
 *   1. Auth (`authenticateV2Request`).
 *   2. Si falla, devuelve la Response correspondiente con headers de
 *      rate-limit/Retry-After.
 *   3. Si OK, devuelve `apiKey` para uso del handler + helpers de meta.
 */

import type { NextRequest } from 'next/server'
import { authenticateV2Request, type AuthSuccess } from '@/lib/api/v2-auth'
import { apiV2Error } from '@/lib/api/v2-response'
import type { V2Scope } from '@/lib/api/v2-scopes'

export type RequireKeyResult =
  | { ok: true; auth: AuthSuccess }
  | { ok: false; response: Response }

/**
 * Wrap del flujo: si la auth falla, construye la Response con los headers
 * adecuados (incluyendo `Retry-After` cuando aplica).
 */
export async function requireApiKey(
  request: NextRequest | Request,
  requiredScope: V2Scope,
): Promise<RequireKeyResult> {
  const auth = await authenticateV2Request(request, requiredScope)
  if (!auth.ok) {
    const headers: Record<string, string> = {}
    if (auth.code === 'RATE_LIMITED' && typeof auth.retryAfterMs === 'number') {
      headers['Retry-After'] = String(Math.ceil(auth.retryAfterMs / 1000))
    }
    return {
      ok: false,
      response: apiV2Error(auth.code, auth.message, { headers }),
    }
  }
  return { ok: true, auth }
}

/**
 * Parsea cursor (`?cursor=<id>&limit=<n>`) con defaults seguros.
 * `limit` se acota a [1, 100].
 */
export function parsePagination(url: URL): { cursor: string | null; limit: number } {
  const cursor = url.searchParams.get('cursor')
  const rawLimit = url.searchParams.get('limit')
  let limit = 50
  if (rawLimit) {
    const n = Number(rawLimit)
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) {
      limit = Math.min(100, n)
    }
  }
  return { cursor: cursor || null, limit }
}
