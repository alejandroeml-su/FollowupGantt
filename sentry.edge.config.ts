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

if (enabled) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sampleRate: 0.1,
    tracesSampleRate: 0.05,
    release: process.env.SENTRY_RELEASE,
  })
}

export const sentryEnabled = enabled
