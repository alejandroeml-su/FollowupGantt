/**
 * Next 16 · Hook `register()` — punto único de inicialización del
 * runtime server-side. Aquí cargamos la configuración Sentry que
 * corresponde al runtime activo (Node o Edge), evitando bundle bloat.
 *
 * Ver `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

/**
 * Hook que Sentry expone para enriquecer errores capturados por el
 * `error.tsx` boundary y por nested route errors. Sólo se invoca si
 * Sentry está activo; en otros casos es no-op.
 */
export async function onRequestError(
  error: unknown,
  request: {
    path: string
    method: string
    headers: Record<string, string | string[] | undefined>
  },
  context: {
    routerKind: 'Pages Router' | 'App Router'
    routePath: string
    routeType: 'render' | 'route' | 'action' | 'middleware'
  },
): Promise<void> {
  if (!process.env.SENTRY_DSN || process.env.NODE_ENV !== 'production') {
    return
  }
  // Import dinámico para no inflar el bundle cuando Sentry no aplica.
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureRequestError(error, request, context)
}
