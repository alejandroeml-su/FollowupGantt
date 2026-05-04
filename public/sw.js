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

const VERSION = 'v1'
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

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, RUNTIME_CACHE).catch(
        () =>
          new Response(
            '<!doctype html><meta charset="utf-8"><title>Sin conexión</title><body style="font-family:system-ui;padding:2rem"><h1>Sin conexión</h1><p>No hay red disponible. Vuelve a intentar cuando se restablezca.</p></body>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ),
      ),
    )
  }
})
