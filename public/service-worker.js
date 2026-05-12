/* eslint-disable no-restricted-globals */
/**
 * Sync · FollowupGantt — Service Worker (Wave P20-A PWA installable)
 *
 * Estrategias de cache:
 *   - **App shell + assets estáticos** (`.js`, `.css`, `.svg`, `.png`,
 *     `.woff2`, `.ico`): stale-while-revalidate. Sirve cache de inmediato
 *     y refresca en background.
 *   - **API routes** (`/api/**`): network-first con timeout de 3s y
 *     fallback a cache si la red no responde a tiempo. Devuelve 503
 *     JSON `{ error: 'offline' }` si tampoco hay cache.
 *   - **Imágenes** (`/icons/**`, `.png`, `.jpg`, `.webp`, `.gif`):
 *     cache-first (long-lived).
 *   - **Navegación HTML**: network-first con fallback a página offline
 *     inline (graceful degradation).
 *
 * Listeners adicionales:
 *   - `push`: muestra notificación nativa (payload JSON cifrado vía
 *     VAPID). Estructura `{ title, body, url, tag, data }`.
 *   - `notificationclick`: enfoca pestaña abierta o abre nueva en la
 *     URL provista por el payload.
 *
 * Sin dependencias externas (vanilla JS).
 *
 * NOTA: el SW heredado `/sw.js` (Wave P4-3) sigue activo para clientes
 * con cache previa. Este `/service-worker.js` es el nuevo canónico
 * registrado por `src/lib/pwa/register-sw.ts`.
 *
 * IMPORTANTE: bumpear VERSION en cada cambio del SW. El handler
 * `activate` borra caches que no coincidan con la versión actual,
 * evitando que clientes sirvan bundles Next.js de deploys previos
 * (causa raíz del bug "Failed to find Server Action ... older or
 * newer deployment").
 */

// Bump VERSION en cada release que cambie bundles Next.js / Server Actions.
// Los caches `sync-*-${VERSION}` se invalidan automáticamente en `activate`.
// v2 · 2026-05-11 (R4.0 GA) — tras 44 commits acumulados de R3.0 + R4.0,
// los Server Action IDs cambiaron y el SW v1 servía bundles obsoletos
// causando "This page couldn't load" en /brain y otras rutas con
// llamadas a server actions (incidente reportado por Edwin).
// v4 · 2026-05-11 · fix navegación HTML siempre a red (causa real del
// React error #482: cache HTML stale → bundle JS viejo → Server Action
// IDs faltantes → use(rejected promise) → "This page couldn't load").
// v5 · 2026-05-12 · click sobre tarea en /gantt sigue crashando con
// "page couldn't load". Causa: clientes con SW v1/v2/v3 todavía activo
// que cachean chunks Next.js no-`/_next/` (legacy paths). Bump fuerza
// install→activate ciclo en TODOS los clientes y elimina cualquier
// cache nombrada `sync-*-${OLD}` (handler `activate` ya lo hace).
const VERSION = "v5-r4-2026-05-12-gantt-task-click";
const STATIC_CACHE = `sync-static-${VERSION}`;
const RUNTIME_CACHE = `sync-runtime-${VERSION}`;
const API_CACHE = `sync-api-${VERSION}`;
const IMAGE_CACHE = `sync-image-${VERSION}`;

const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icon-sync.svg",
];

const API_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => {
        // No bloquear el install si algun recurso falla (dev/offline).
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const valid = new Set([STATIC_CACHE, RUNTIME_CACHE, API_CACHE, IMAGE_CACHE]);
      await Promise.all(
        keys.filter((k) => !valid.has(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();

      // Tras invalidar caches viejos, fuerza a las páginas abiertas a
      // hacer hard refresh. Esto evita "This page couldn't load" cuando
      // los chunks Next.js / Server Action IDs del bundle previo ya no
      // existen en el deploy nuevo. El cliente recibe el mensaje y
      // ejecuta `location.reload()` (lo maneja register-sw.ts).
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientsList) {
        try {
          client.postMessage({ type: "SW_VERSION_UPDATED", version: VERSION });
        } catch {
          // Cliente cerrado o sin canal — ignoramos.
        }
      }
    })(),
  );
});

// ─── Helpers de clasificacion ────────────────────────────────

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isImageRequest(url) {
  if (url.pathname.startsWith("/icons/")) return true;
  return /\.(?:png|jpg|jpeg|webp|gif|ico)$/i.test(url.pathname);
}

function isStaticAsset(url) {
  return /\.(?:js|css|svg|woff2?|ttf)$/i.test(url.pathname);
}

/**
 * `/_next/` aloja los bundles del cliente Next.js. Cada deploy regenera
 * hashes; si el SW sirve un chunk antiguo, el cliente envia un Server
 * Action ID que el servidor nuevo no reconoce. Pasamos todo `/_next/`
 * directo a la red (los chunks ya tienen `Cache-Control: immutable`).
 */
function isNextInternal(url) {
  return url.pathname.startsWith("/_next/");
}

// ─── Estrategias ────────────────────────────────────────────

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === "basic") {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => undefined);

  return cached || (await networkPromise) || Response.error();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return Response.error();
  }
}

async function networkFirstWithTimeout(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  let timer;
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("network-timeout")),
          timeoutMs,
        );
      }),
    ]);
    clearTimeout(timer);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    clearTimeout(timer);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("network-failed-and-no-cache");
  }
}

// ─── Fetch handler ──────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Solo GET cacheable; mutaciones pasan directo.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Solo same-origin para no interferir con CDNs externos.
  if (url.origin !== self.location.origin) return;

  // El SW y el manifest siempre frescos (no cachear el SW a si mismo).
  if (url.pathname === "/service-worker.js" || url.pathname === "/sw.js") {
    return;
  }

  // `/_next/` directo a la red — ver isNextInternal.
  if (isNextInternal(url)) return;

  if (isApiRequest(url)) {
    event.respondWith(
      networkFirstWithTimeout(request, API_CACHE, API_TIMEOUT_MS).catch(
        () =>
          new Response(
            JSON.stringify({ error: "offline", message: "Sin conexion" }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );
    return;
  }

  if (isImageRequest(url)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // NAVEGACIÓN HTML: SIEMPRE red, NUNCA cache. El cache HTML stale sirve
  // bundles JS viejos cuyos Server Action IDs ya no existen en el deploy
  // nuevo → React lanza error #482 (use(rejected promise) en Object.iC).
  // Mejor mostrar página offline real que servir HTML obsoleto.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sync · Sin conexion</title><style>body{font-family:system-ui;background:#0f0f17;color:#e2e8f0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem;text-align:center}h1{color:#4f46e5}button{background:#4f46e5;color:#fff;border:none;padding:.6rem 1.2rem;border-radius:.5rem;cursor:pointer;font-size:1rem;margin-top:1rem}</style></head><body><h1>Sync · Sin conexion</h1><p>No hay red disponible. Vuelve a intentar cuando se restablezca.</p><button onclick="location.reload()">Reintentar</button></body></html>',
            {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          ),
      ),
    );
  }
});

// ─── Mensajes desde el cliente ──────────────────────────────

self.addEventListener("message", (event) => {
  // Permite al cliente forzar skipWaiting cuando el usuario acepta el
  // banner "Nueva version disponible · Recargar".
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ─── Web Push ───────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try {
      const text = event.data ? event.data.text() : "";
      if (text) data = { title: "Sync", body: text };
    } catch {
      data = {};
    }
  }

  const title = data.title || "Sync";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/", ...(data.data || {}) },
    tag: data.tag || undefined,
    renotify: !!data.renotify,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if (client.url && "focus" in client) {
          try {
            await client.focus();
            if ("navigate" in client && targetUrl) {
              try {
                await client.navigate(targetUrl);
              } catch {
                // navigate puede fallar entre orígenes; ignoramos.
              }
            }
            return;
          } catch {
            // continúa con la siguiente
          }
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
