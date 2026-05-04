/**
 * Sentry · Configuración del runtime Node.js (server).
 *
 * Aplica a Server Components, Server Actions, Route Handlers y a
 * cualquier código que se ejecute en el runtime Node.js de Next 16.
 *
 * Igual que en cliente, el SDK queda *no-op* si no hay `SENTRY_DSN` o
 * si no estamos en producción — esto evita que CI o entornos locales
 * envíen eventos a la organización compartida.
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
    // Evita capturar PII por defecto. Si en el futuro se necesita
    // user-id, hay que poner `setUser` explícito en código (server
    // action wrapper) — nunca activar `sendDefaultPii: true` global.
    sendDefaultPii: false,
  })
}

export const sentryEnabled = enabled
