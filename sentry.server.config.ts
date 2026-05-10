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

/**
 * Wave P14d (Hardening Pre-POC) — alerting tunning.
 *
 * Reglas para diferenciar errores que merecen alerta vs. ruido:
 *
 *   - Errores de validación esperados ([INVALID_INPUT], [NOT_FOUND],
 *     [UNAUTHORIZED], [FORBIDDEN]) NO van a Sentry (son control de flujo).
 *   - Errores LLM esperados ([LLM_NO_CLIENT], [LLM_FAILED]) NO alertan
 *     porque ya hay fallback heurístico que cubre la UX.
 *   - Errores Prisma de constraint ([P2002], [P2025]) van con tag
 *     `category=db.constraint` para filtrar en dashboards.
 *   - Errores no clasificados van con sampleRate 100% para no perderlos.
 *   - Performance traces · sampleRate 5% (cap para Hobby plan).
 */
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
    // Wave P14d — los errores no-suprimidos se mandan al 100% para
    // garantizar que críticos lleguen. El sampleRate 0.1 anterior
    // perdía el 90% de incidentes aislados (Heisenbugs).
    sampleRate: 1.0,
    tracesSampleRate: 0.05,
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,

    /**
     * Filtra errores de control de flujo y enriquece tags antes de
     * enviar a Sentry. Devuelve `null` para descartar el evento.
     */
    beforeSend(event, hint) {
      const errMsg =
        (hint?.originalException instanceof Error
          ? hint.originalException.message
          : event.exception?.values?.[0]?.value) ?? ''

      // Suprimir errores de control de flujo · son negocio, no incidentes.
      for (const prefix of SUPPRESSED_ERROR_PREFIXES) {
        if (errMsg.startsWith(prefix)) {
          return null
        }
      }

      // Tag por categoría DB constraint para filtros de dashboard.
      if (errMsg.includes('P2002') || errMsg.includes('P2025')) {
        event.tags = { ...event.tags, category: 'db.constraint' }
      }

      // Tag por área del sistema (mejora triage).
      if (event.transaction) {
        if (event.transaction.startsWith('/api/cron/')) {
          event.tags = { ...event.tags, area: 'cron' }
        } else if (event.transaction.startsWith('/api/')) {
          event.tags = { ...event.tags, area: 'api' }
        } else if (event.transaction.includes('/brain')) {
          event.tags = { ...event.tags, area: 'brain-ai' }
        }
      }

      return event
    },
  })
}

export const sentryEnabled = enabled
