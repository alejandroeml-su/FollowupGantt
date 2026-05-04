/**
 * API REST v1 (Ola P4 · Equipo P4-2) — helpers de respuesta de error.
 *
 * Convención canónica del repo (alineada con server actions): los errores de
 * la API devuelven un body JSON `{ error: { code, message } }` y el código
 * HTTP correspondiente. El `code` es estable y machine-readable (UPPER_SNAKE);
 * el `message` es human-readable y puede ser internacionalizado por el cliente.
 *
 * Tabla de códigos HTTP:
 *   - 400 INVALID_INPUT      payload no parsea / faltan campos.
 *   - 401 UNAUTHORIZED       sin token / token inválido / expirado / revocado.
 *   - 403 FORBIDDEN          token válido pero sin scope/permiso.
 *   - 404 NOT_FOUND          recurso no existe (o el caller no puede verlo).
 *   - 409 CONFLICT           duplicado / estado inconsistente (ej. dep ya existe).
 *   - 422 UNPROCESSABLE      validación semántica falla (ciclo CPM, lag fuera de rango).
 *   - 500 INTERNAL_ERROR     fallback para excepciones inesperadas.
 *
 * `mapServerActionError` traduce el patrón de errores tipados de las server
 * actions (`Error("[CODE] detalle")`) al formato de respuesta API.
 */

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DEPENDENCY_EXISTS: 409,
  CYCLE_DETECTED: 422,
  NEGATIVE_FLOAT: 422,
  SELF_DEPENDENCY: 422,
  CROSS_PROJECT: 422,
  INVALID_LAG: 422,
  INVALID_TYPE: 422,
  BASELINE_CAP_REACHED: 409,
  PROJECT_EMPTY: 422,
  INVALID_SNAPSHOT: 422,
  INTERNAL_ERROR: 500,
}

export function statusForCode(code: string): number {
  return STATUS_BY_CODE[code] ?? 500
}

/**
 * Construye una `Response` JSON con el shape canónico del error.
 * Marca `Cache-Control: no-store` para que CDNs no cacheen errores.
 */
export function apiError(
  code: string,
  message: string,
  status?: number,
): Response {
  const body: ApiErrorBody = { error: { code, message } }
  return new Response(JSON.stringify(body), {
    status: status ?? statusForCode(code),
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Construye una `Response` JSON exitosa. Default status 200.
 * Marca `Cache-Control: no-store` para writes; los reads pueden override.
 */
export function apiOk(data: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init?.headers ?? {}),
    },
  })
}

/**
 * Parsea el patrón `[CODE] detalle` de los errores tipados de server actions
 * y devuelve `{code, message}`. Fallback a INTERNAL_ERROR si no machea.
 */
export function parseTaggedError(err: unknown): { code: string; message: string } {
  if (!(err instanceof Error)) {
    return { code: 'INTERNAL_ERROR', message: String(err) }
  }
  const m = /^\[([A-Z_]+)\]\s*(.*)$/.exec(err.message)
  if (m) {
    return { code: m[1], message: m[2] || err.message }
  }
  return { code: 'INTERNAL_ERROR', message: err.message }
}

/**
 * Atajo: convierte cualquier excepción al `Response` API correspondiente.
 * Útil dentro de los `route.ts` para wrappear el handler con un try/catch
 * uniforme y delegar el mapeo aquí.
 */
export function errorResponseFromException(err: unknown): Response {
  const { code, message } = parseTaggedError(err)
  return apiError(code, message)
}
