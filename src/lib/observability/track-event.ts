/**
 * `trackEvent(name, properties?)` · helper para business metrics.
 *
 * No usamos `Sentry.metrics` porque la API está marcada como experimental
 * en v10 y su DX cambia con frecuencia. Optamos por un breadcrumb de
 * categoría `business` + un `captureMessage` de nivel `info` con tags
 * — esto produce un evento agregable en Sentry Discover y mantiene
 * compatibilidad hacia adelante.
 *
 * Convención de naming: `dominio.acción` en lower-case, e.g.:
 *   - `task.created`
 *   - `task.completed`
 *   - `baseline.captured`
 *   - `gantt.exported`
 */
import * as Sentry from '@sentry/nextjs'

import { sanitizeContext, type LogContext } from './logger'

const isProd = (): boolean => process.env.NODE_ENV === 'production'
const sentryActive = (): boolean => {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
  return Boolean(dsn) && isProd()
}

/**
 * Propiedades de un evento de negocio. Limitamos a tipos primitivos
 * serializables para que Sentry los indexe como tags.
 */
export type EventProperties = Record<
  string,
  string | number | boolean | null | undefined
>

/**
 * Registra un evento de negocio. En prod con Sentry activo:
 *   1. Añade un breadcrumb (category: 'business') — gratis.
 *   2. Emite `captureMessage` con tags — agregable en Discover.
 *
 * En dev / sin DSN imprime el evento en consola para inspección rápida.
 */
export function trackEvent(name: string, properties?: EventProperties): void {
  // Sanitizamos por las dudas — un dev podría meter un token aquí.
  const safeProps = sanitizeContext(properties as LogContext | undefined)

  if (sentryActive()) {
    Sentry.addBreadcrumb({
      category: 'business',
      level: 'info',
      message: name,
      data: safeProps,
    })

    Sentry.withScope((scope) => {
      scope.setTag('event', name)
      scope.setLevel('info')
      // Pasamos las propiedades como tags individuales para que sean
      // filtrables en Sentry. Sólo primitivos sobreviven; los demás
      // van como context.
      for (const [key, value] of Object.entries(safeProps)) {
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          scope.setTag(key, String(value))
        }
      }
      scope.setContext('event', safeProps)
      Sentry.captureMessage(`event:${name}`, 'info')
    })
    return
  }

  console.info(`[event] ${name}`, safeProps)
}
