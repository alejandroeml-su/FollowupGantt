'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker `/sw.js` (P4-3 PWA) tras el primer mount del
 * cliente. Solo en producción para evitar caches stale durante `next dev`,
 * y solo si el browser soporta service workers (descartamos iOS antiguo).
 *
 * Se monta una sola vez en `layout.tsx` y no renderiza UI.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // No bloquear la app si el SW no se registra (ej. file://, http
          // sin secure context). Logueamos solo en consola.
          console.warn('[sw] registration failed:', err)
        })
    }

    if (document.readyState === 'complete') {
      onLoad()
    } else {
      window.addEventListener('load', onLoad, { once: true })
      return () => window.removeEventListener('load', onLoad)
    }
  }, [])

  return null
}
