/**
 * Sentry · Configuración del runtime Edge.
 *
 * El runtime Edge (middleware, route handlers con `runtime: 'edge'`)
 * tiene un subset reducido de APIs Node, por eso Sentry mantiene un
 * bundle separado. Aplican los mismos sample rates que server.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN
const enabled = Boolean(dsn) && process.env.NODE_ENV === 'production'

// Wave P14d — mismo tunning que server (errores de control de flujo no
// alertan, sample 100% para los demás).
const SUPPRESSED_ERROR_PREFIXES: ReadonlyArray<string> = [
  '[INVALID_INPUT]',
  '[NOT_FOUND]',
  '[UNAUTHORIZED]',
  '[FORBIDDEN]',
  '[LLM_NO_CLIENT]',
  '[LLM_FAILED]',
  '[BRAIN_AI]',
]

if (enabled) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sampleRate: 1.0,
    tracesSampleRate: 0.05,
    release: process.env.SENTRY_RELEASE,
    beforeSend(event, hint) {
      const errMsg =
        (hint?.originalException instanceof Error
          ? hint.originalException.message
          : event.exception?.values?.[0]?.value) ?? ''
      for (const prefix of SUPPRESSED_ERROR_PREFIXES) {
        if (errMsg.startsWith(prefix)) return null
      }
      return event
    },
  })
}

export const sentryEnabled = enabled
