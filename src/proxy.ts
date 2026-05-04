import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'

/**
 * Proxy (antes "middleware") para checks optimistas de autenticación.
 *
 * Next 16: el archivo se llama `proxy.ts` (el `middleware` está
 * deprecado — ver node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 *
 * Estrategia recomendada por la doc:
 *   - SOLO leer la presencia de la cookie, sin desencriptar ni tocar BD
 *     (porque el proxy se ejecuta en cada navegación incluyendo
 *     prefetches). Las verificaciones reales viven en server actions vía
 *     `requireProjectAccess` y en pages vía `getCurrentUser`.
 *   - Redirigir a `/login` cuando se intenta acceder a una ruta
 *     protegida sin cookie. Los servidores de páginas y server actions
 *     son la "second line of defense".
 *
 * Rutas protegidas (HU MVP):
 *   /gantt, /projects, /dashboards, /settings, /list, /kanban, /table,
 *   /workload, /mindmaps, /calendar, /forms, /docs, /automations,
 *   /brain, /gerencias, /project-kpis
 *
 * Rutas públicas (excluidas del check): /login, /api/auth/*, /invite/*
 *
 * Ola P4 · Equipo P4-1 — Multi-tenancy:
 *   - Lee la cookie `x-active-workspace` (httpOnly=false) y la propaga
 *     como header `x-active-workspace` al request, para que server
 *     components y actions puedan leerla con `headers()` sin un round-
 *     trip extra a `cookies()`. La autoridad real del filtro vive en
 *     `requireWorkspaceAccess` (server-only) — el header es sólo hint.
 */

const ACTIVE_WORKSPACE_COOKIE = 'x-active-workspace'

const PROTECTED_PREFIXES = [
  '/gantt',
  '/projects',
  '/dashboards',
  '/settings',
  '/list',
  '/kanban',
  '/table',
  '/workload',
  '/mindmaps',
  '/calendar',
  '/forms',
  '/docs',
  '/automations',
  '/brain',
  '/gerencias',
  '/project-kpis',
  '/poc-gantt',
  '/whiteboards',
]

function isProtected(path: string): boolean {
  for (const prefix of PROTECTED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true
  }
  return false
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname

  // Pasamos el pathname al RootLayout vía header (lo lee con
  // `headers()`). Permite ocultar Sidebar/MobileHeader en `/login` sin
  // route groups invasivos.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', path)

  // Ola P4 — Inyectamos `x-active-workspace` desde la cookie homónima
  // para que server components/actions puedan leerla con `headers()`.
  // Sólo si no llega ya como header (ej. tests con headers explícitos).
  if (!requestHeaders.has(ACTIVE_WORKSPACE_COOKIE)) {
    const activeWs = req.cookies.get(ACTIVE_WORKSPACE_COOKIE)?.value
    if (activeWs) {
      requestHeaders.set(ACTIVE_WORKSPACE_COOKIE, activeWs)
    }
  }

  const passThrough = () =>
    NextResponse.next({ request: { headers: requestHeaders } })

  // Ignorar rutas internas / públicas explícitamente.
  // /invite/<token> es público porque la página se encarga de redirigir
  // a /login si no hay sesión (preserva el `next` con encodeURIComponent).
  if (
    path.startsWith('/_next') ||
    path.startsWith('/api/auth') ||
    path === '/login' ||
    path === '/favicon.ico' ||
    path.startsWith('/invite/')
  ) {
    return passThrough()
  }

  if (!isProtected(path)) {
    return passThrough()
  }

  const hasCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!hasCookie) {
    // E2E_BYPASS_AUTH (P3-4): permite que los specs Playwright carguen
    // rutas protegidas sin cookie real. Solo se honra cuando
    // NODE_ENV !== 'production' como defensa-en-profundidad — si la env
    // var se cuela en Vercel prod no abre la puerta. Las páginas y
    // server actions siguen llamando `getCurrentUser()`, así que el
    // bypass solo evita el redirect a /login (las pages que necesiten
    // un user real seguirán necesitando un seed con `seedAuthUser`).
    if (
      process.env.E2E_BYPASS_AUTH === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      return passThrough()
    }
    const loginUrl = new URL('/login', req.nextUrl)
    // `next` para volver a la página tras login.
    loginUrl.searchParams.set('next', path)
    return NextResponse.redirect(loginUrl)
  }

  return passThrough()
}

// Excluir activos estáticos y APIs internas del matcher (la doc
// recomienda este patrón: «excluir api, _next/static, _next/image y
// archivos estáticos»).
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
