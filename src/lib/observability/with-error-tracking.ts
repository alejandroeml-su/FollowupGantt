/**
 * `withErrorTracking(fn, name)` · HOF para Server Actions.
 *
 * Envuelve una server action de modo que cualquier excepción se reporte
 * a Sentry con metadata útil (nombre de la action + args sanitizados),
 * y luego se vuelve a lanzar para que Next preserve su contrato (la UI
 * sigue viendo el error).
 *
 * Uso:
 * ```ts
 * export const createTask = withErrorTracking(
 *   async (input: CreateTaskInput) => { ... },
 *   'tasks.create',
 * )
 * ```
 *
 * Sin `any`: el wrapper preserva la firma exacta de `fn` vía generics
 * con `Parameters<F>` / `ReturnType<F>`.
 */
import * as Sentry from '@sentry/nextjs'

import { logger, sanitizeContext, type LogContext } from './logger'

/**
 * Convierte argumentos de una function en algo serializable. Truncamos
 * strings largos y omitimos objetos circulares (JSON.stringify falla).
 * Mantiene el límite de bytes de Sentry (256 KB por evento) bajo control.
 */
function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (arg === null || arg === undefined) return arg
    if (typeof arg === 'string') {
      return arg.length > 500 ? `${arg.slice(0, 500)}…` : arg
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') return arg
    // Para objetos: filtramos secrets y serializamos para asegurar
    // que sea seguro pasar a Sentry.
    if (typeof arg === 'object') {
      try {
        const filtered = sanitizeContext(arg as LogContext)
        // round-trip via JSON para descartar funciones/symbols.
        return JSON.parse(JSON.stringify(filtered)) as unknown
      } catch {
        return '[Unserializable]'
      }
    }
    return String(arg)
  })
}

/**
 * Tipo de cualquier server action: `async fn(...args) => unknown`.
 * Usamos `unknown[]` (no `any[]`) para forzar caller a tipar args.
 */
type AnyServerAction = (...args: never[]) => Promise<unknown>

/**
 * Envuelve una server action añadiendo error tracking + breadcrumb de
 * inicio. El nombre `actionName` se usa como tag en Sentry (`action`).
 */
export function withErrorTracking<F extends AnyServerAction>(
  fn: F,
  actionName: string,
): F {
  const wrapped = async (...args: Parameters<F>): Promise<Awaited<ReturnType<F>>> => {
    // Breadcrumb de "entered action" — barato (no envía evento) y útil
    // para reconstruir el camino que llevó al error.
    Sentry.addBreadcrumb({
      category: 'server-action',
      level: 'info',
      message: `→ ${actionName}`,
    })

    try {
      const result = await fn(...args)
      return result as Awaited<ReturnType<F>>
    } catch (err) {
      logger.error(err, {
        action: actionName,
        args: sanitizeArgs(args as unknown[]),
      })
      // Re-throw: Next.js convierte excepciones en error boundaries y
      // la UI debe seguir reaccionando como sin el wrapper.
      throw err
    }
  }
  return wrapped as F
}
