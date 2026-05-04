/**
 * Sentry · Configuración del cliente (browser).
 *
 * Inicializa el SDK únicamente cuando hay `NEXT_PUBLIC_SENTRY_DSN`
 * disponible y estamos en producción. En cualquier otro contexto el
 * módulo es un *no-op* total para evitar costos de red, ruido en logs
 * locales y filtraciones accidentales de eventos durante PRs.
 *
 * Sample rates conservadores (D-C2):
 *  - errors:        0.10 (10%)
 *  - performance:   0.05 (5%)
 * Edwin puede subirlos vía panel de Sentry sin cambiar código.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
const enabled = Boolean(dsn) && process.env.NODE_ENV === 'production'

if (enabled) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    // 10% de los errores capturados son enviados a Sentry. Mantiene el
    // plan free dentro de cuota mientras el proyecto madura.
    sampleRate: 0.1,
    // 5% de las transacciones (performance). Sentry recomienda <=0.1
    // para aplicaciones con tráfico medio.
    tracesSampleRate: 0.05,
    // Las release/source-maps se inyectan en build vía `withSentryConfig`.
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    // Filtra ruido típico de extensiones de navegador y errores de red
    // que no aportan valor accionable.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
    ],
  })
}

export const sentryEnabled = enabled
