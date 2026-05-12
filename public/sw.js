/* eslint-disable no-restricted-globals */
/**
 * FollowupGantt — Service Worker (P4-3 Mobile + PWA)
 *
 * Estrategias:
 *   - Stale-while-revalidate para assets estáticos (.js, .css, .svg, .png,
 *     .woff2, .ico) en el origen propio. Sirve cache inmediatamente y
 *     refresca en background.
 *   - Network-first para llamadas a /api/* (datos vivos), con fallback a
 *     cache si no hay red. Esto da tolerancia a red flaky en mobile sin
 *     servir datos rancios cuando la red sí responde.
 *   - Navegación HTML: network-first con fallback a cache (offline básico).
 *
 * Sin deps externas (vanilla JS) — restricción del scope P4-3.
 */

// IMPORTANTE: bumpear VERSION en cada cambio del SW. El handler `activate`
// borra cualquier cache cuyo nombre no coincida exactamente con los actuales,
// forzando a clientes existentes a descartar bundles viejos. Esto desbloquea
// el bug `Failed to find Server Action ... older or newer deployment` que
// se producía cuando el SW servía chunks Next.js de un deploy previo.
// v4 · 2026-05-11 (R4.0 GA) — sincronizado con bump del SW canónico
// `/service-worker.js` (v2-r4-2026-05-11). Mismo motivo: invalidar
// bundles Next.js + Server Action IDs del deploy previo.
// v5 · 2026-05-11 · sincronizado con SW canónico v4-no-html-cache.
// v6 · 2026-05-12 · sincronizado con SW canónico v5 — bump fuerza
// install→activate en clientes legacy todavía con `/sw.js` registrado
// (los que migran al canónico ya están en v5 vía service-worker.js).
const VERSION = 'v6'
const STATIC_CACHE = `fg-static-${VERSION}`
const RUNTIME_CACHE = `fg-runtime-${VERSION}`
const API_CACHE = `fg-api-${VERSION}`

const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {
        // No bloquear el install si algún recurso falla (ej. desarrollo).
      }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => ![STATIC_CACHE, RUNTIME_CACHE, API_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

function isStaticAsset(url) {
  return /\.(?:js|css|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/i.test(url.pathname)
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/')
}

/**
 * `/_next/` aloja los bundles del cliente Next.js (chunks RSC, app-router,
 * webpack-runtime). Cada deploy genera nuevos hashes y nuevos IDs de
 * Server Actions; si el SW sirve un chunk de un deploy previo, el cliente
 * envía un Server Action ID que el servidor nuevo no reconoce y obtenemos
 * `Failed to find Server Action ... older or newer deployment`.
 *
 * Solución: pasar TODO `/_next/` directo a la red (sin tocar SW). Los
 * chunks immutables de Next ya tienen `Cache-Control: public, max-age=...,
 * immutable` y los maneja el HTTP cache del navegador correctamente.
 */
function isNextInternal(url) {
  return url.pathname.startsWith('/_next/')
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {})
      }
      return response
    })
    .catch(() => undefined)

  return cached || (await networkPromise) || Response.error()
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    throw new Error('Network error and no cached response')
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Solo GET cacheable; POST/PUT/DELETE pasan directos.
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Solo manejamos same-origin para no romper integraciones externas.
  if (url.origin !== self.location.origin) return

  // No cacheamos el SW ni el manifest.json (siempre fresh).
  if (url.pathname === '/sw.js') return

  // `/_next/` directo a la red — ver JSDoc de `isNextInternal` arriba.
  if (isNextInternal(url)) return

  if (isApiRequest(url)) {
    event.respondWith(
      networkFirst(request, API_CACHE).catch(
        () =>
          new Response(
            JSON.stringify({ error: 'offline', message: 'Sin conexión' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  // Navegación HTML: SIEMPRE red, NUNCA cache. Ver comentario equivalente
  // en service-worker.js (fix React error #482 2026-05-11).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            '<!doctype html><meta charset="utf-8"><title>Sin conexión</title><body style="font-family:system-ui;padding:2rem"><h1>Sin conexión</h1><p>No hay red disponible. Vuelve a intentar cuando se restablezca.</p></body>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ),
      ),
    )
  }
})

// ─── Wave P6 · Equipo A4 — Web Push API ─────────────────────────────
// Handler `push`: muestra notificación nativa del SO con icono y data
// para que `notificationclick` abra la URL relevante. El payload llega
// cifrado desde `webpush.sendNotification(sub, JSON.stringify(payload))`
// en `src/lib/web-push/server.ts`. Si el `data` viene vacío (push sin
// payload), mostramos un fallback genérico.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Payload no era JSON: caemos a texto plano.
    try {
      const text = event.data ? event.data.text() : ''
      if (text) data = { title: 'FollowupGantt', body: text }
    } catch {
      data = {}
    }
  }

  const title = data.title || 'FollowupGantt'
  const options = {
    body: data.body || '',
    icon: '/icon-192.svg',
    badge: '/icon-192.svg',
    data: { url: data.url || '/', ...(data.data || {}) },
    tag: data.tag || undefined,
    renotify: !!data.renotify,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// Click handler: enfoca un cliente abierto en la misma URL si existe;
// si no, abre uno nuevo. Cierra siempre la notificación.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of all) {
        // Reenfocamos si ya hay una ventana del mismo origen.
        if (client.url && 'focus' in client) {
          try {
            await client.focus()
            if ('navigate' in client && targetUrl) {
              try {
                await client.navigate(targetUrl)
              } catch {
                // navigate puede fallar entre orígenes; ignoramos.
              }
            }
            return
          } catch {
            // continúa con la siguiente
          }
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl)
      }
    })(),
  )
})
