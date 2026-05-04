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
 * Rutas públicas (excluidas del check): /login, /api/auth/*
 */

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
  // '/forms' está PÚBLICO en P5: los formularios `/forms/<slug>` se
  // sirven sin auth (captura externa de tickets). El listado interno se
  // mueve a `/settings/forms`.
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

  const passThrough = () =>
    NextResponse.next({ request: { headers: requestHeaders } })

  // Ignorar rutas internas / públicas explícitamente.
  if (
    path.startsWith('/_next') ||
    path.startsWith('/api/auth') ||
    path === '/login' ||
    path === '/favicon.ico'
  ) {
    return passThrough()
  }

  if (!isProtected(path)) {
    return passThrough()
  }

  const hasCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!hasCookie) {
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
