/**
 * Wave P17-B (API pública v2) · Helpers de respuesta JSON.
 *
 * Shape canónico:
 *   éxito: { data, meta?: { cursor, total } }
 *   error: { error: { code, message } }
 *
 * Códigos HTTP:
 *   - 200/201 OK
 *   - 400 INVALID_INPUT
 *   - 401 INVALID_KEY
 *   - 403 INSUFFICIENT_SCOPE
 *   - 404 NOT_FOUND
 *   - 422 UNPROCESSABLE
 *   - 429 RATE_LIMITED (Retry-After header)
 *   - 500 INTERNAL_ERROR
 */

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  INVALID_KEY: 401,
  INSUFFICIENT_SCOPE: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
}

export function statusForV2Code(code: string): number {
  return STATUS_BY_CODE[code] ?? 500
}

export interface ApiV2Meta {
  cursor?: string | null
  total?: number
}

export function apiV2Ok<T>(
  data: T,
  init?: { status?: number; meta?: ApiV2Meta; headers?: Record<string, string> },
): Response {
  const body = init?.meta ? { data, meta: init.meta } : { data }
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-API-Version': 'v2',
      ...(init?.headers ?? {}),
    },
  })
}

export function apiV2Error(
  code: string,
  message: string,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status: init?.status ?? statusForV2Code(code),
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-API-Version': 'v2',
      ...(init?.headers ?? {}),
    },
  })
}

/**
 * Parsea el patrón `[CODE] detalle` típico del repo y devuelve {code,message}.
 * Fallback INTERNAL_ERROR para excepciones no taggeadas.
 */
export function parseTaggedError(err: unknown): { code: string; message: string } {
  if (!(err instanceof Error)) {
    return { code: 'INTERNAL_ERROR', message: String(err) }
  }
  const m = /^\[([A-Z_]+)\]\s*(.*)$/.exec(err.message)
  if (m) return { code: m[1], message: m[2] || err.message }
  return { code: 'INTERNAL_ERROR', message: err.message }
}

export function errorResponseFromException(err: unknown): Response {
  const { code, message } = parseTaggedError(err)
  return apiV2Error(code, message)
}
