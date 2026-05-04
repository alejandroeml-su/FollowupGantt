/**
 * Next 16 · `instrumentation-client.ts` — código que se ejecuta en el
 * navegador antes de la hidratación de React. Lo usamos para inicializar
 * Sentry en cliente (importando `sentry.client.config.ts`) y para
 * registrar breadcrumbs de navegación.
 *
 * Ver `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md`.
 */
import * as Sentry from '@sentry/nextjs'

// Side-effect import: inicializa Sentry según las env vars.
import '../sentry.client.config'

/**
 * Hook que Next invoca al iniciar una transición de ruta. Sentry lo usa
 * para correlacionar pageloads con transacciones; el helper oficial
 * `captureRouterTransitionStart` se encarga de detectar si la SDK está
 * inicializada (es no-op si no lo está).
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
