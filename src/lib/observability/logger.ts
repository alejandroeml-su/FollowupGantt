/**
 * Logger estructurado · Wave C2 (Observability).
 *
 * Tres niveles: `info`, `warn`, `error`. Acepta un `LogContext` con
 * campos de negocio (userId, projectId, action, ...) que viajan como
 * `extra`/`tags` a Sentry y como JSON serializado a `console`.
 *
 * Reglas:
 *  - En producción **con** `SENTRY_DSN` activo: envía a Sentry.
 *  - En cualquier otro caso: imprime con `console.{info|warn|error}`.
 *  - Si Sentry está activo, también imprimimos `console.error` para
 *    `error()` — facilita debugging local cuando un dev habilita Sentry
 *    con un DSN de staging y quiere ver el mismo evento en consola.
 *
 * Sin `any`: el contexto es `Record<string, unknown>` con campos
 * conocidos opcionales tipados.
 */
import * as Sentry from '@sentry/nextjs'

/**
 * Campos comunes con los que tagueamos eventos. Todos opcionales — el
 * caller puede omitir cualquiera. `Record<string, unknown>` permite
 * agregar metadata libre sin perder el typing de los campos conocidos.
 */
export interface LogContext extends Record<string, unknown> {
  userId?: string
  projectId?: string
  taskId?: string
  action?: string
  /** Identificador correlacional entre logs/spans (e.g. trace id). */
  correlationId?: string
}

const isProd = (): boolean => process.env.NODE_ENV === 'production'

/**
 * Determina si debemos enviar a Sentry. Mantenemos lazy-eval (función,
 * no constante) para que tests puedan stubear `process.env` por caso.
 */
const sentryActive = (): boolean => {
  // Server: SENTRY_DSN. Client: NEXT_PUBLIC_SENTRY_DSN.
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
  return Boolean(dsn) && isProd()
}

/**
 * Sanitiza el contexto eliminando claves que parecen contener secrets.
 * Heurística simple basada en nombre — suficiente para evitar leaks
 * accidentales de tokens/passwords vía logs.
 */
const SECRET_KEY_PATTERN = /(password|secret|token|apikey|api_key|authorization|cookie)/i

export function sanitizeContext(ctx: LogContext | undefined): LogContext {
  if (!ctx) return {}
  const out: LogContext = {}
  for (const [key, value] of Object.entries(ctx)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]'
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * `logger.info(msg, ctx?)` — eventos informativos. En prod los enviamos
 * a Sentry como `breadcrumb` (no son eventos, son contexto para errores
 * posteriores). En dev se imprimen con `console.info`.
 */
function info(message: string, context?: LogContext): void {
  const safe = sanitizeContext(context)
  if (sentryActive()) {
    Sentry.addBreadcrumb({
      category: 'log',
      level: 'info',
      message,
      data: safe,
    })
    return
  }
  console.info(`[info] ${message}`, safe)
}

/**
 * `logger.warn(msg, ctx?)` — eventos preocupantes pero no errores. En
 * prod los enviamos como `captureMessage(level: 'warning')`. Sentry los
 * agrupa por mensaje, ideal para condiciones recuperables (e.g. cache
 * miss, fallback paths).
 */
function warn(message: string, context?: LogContext): void {
  const safe = sanitizeContext(context)
  if (sentryActive()) {
    Sentry.withScope((scope) => {
      scope.setLevel('warning')
      scope.setContext('log', safe)
      Sentry.captureMessage(message, 'warning')
    })
    return
  }
  console.warn(`[warn] ${message}`, safe)
}

/**
 * `logger.error(err, ctx?)` — captura excepciones. Acepta tanto un
 * `Error` real como un string (lo envuelve para preservar stack-less).
 * En prod hace `Sentry.captureException`; en dev imprime con
 * `console.error`. Cuando Sentry está activo, también imprimimos a
 * consola para no perder visibilidad local.
 */
function error(err: unknown, context?: LogContext): void {
  const safe = sanitizeContext(context)
  const exception = err instanceof Error ? err : new Error(String(err))

  if (sentryActive()) {
    Sentry.withScope((scope) => {
      scope.setLevel('error')
      scope.setContext('log', safe)
      Sentry.captureException(exception)
    })
    // No retornamos: en error queremos también traza local en prod.
  }
  console.error(`[error] ${exception.message}`, { ...safe, stack: exception.stack })
}

export const logger = {
  info,
  warn,
  error,
}

// Exposición separada para tests (permite stub determinista).
export const __internals = {
  sentryActive,
  isProd,
}
