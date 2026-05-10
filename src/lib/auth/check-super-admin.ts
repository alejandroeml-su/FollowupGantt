import 'server-only'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { isSuperAdmin } from '@/lib/auth/permissions'
import { recordAuditEventSafe } from '@/lib/audit/events'
import type { SessionUser } from '@/lib/auth/session'

/**
 * Wave P17-C · Self-Service Admin.
 *
 * Guard estricto para el panel `/admin/**`. SOLO SUPER_ADMIN puede
 * atravesarlo. Cualquier otro caller (anónimo, USER, ADMIN, GERENCIA, etc.)
 * recibe un `redirect('/')` con un audit log `access.denied` para mantener
 * traza forense.
 *
 * Convenciones del repo:
 *   - `'use server'` purity: este módulo es server-only (no exporta nada
 *     que un Client Component pueda importar).
 *   - Errores tipados `[CODE]`: la versión `requireSuperAdminOrThrow`
 *     lanza `[FORBIDDEN]` para server actions; la versión `requireSuperAdmin`
 *     redirige (apta para layouts/page server components).
 *   - Audit log defensivo: `recordAuditEventSafe` no rompe el flujo si la
 *     escritura falla.
 *
 * D-P17C-1: usamos `redirect('/')` (no `notFound()`) porque el descubrimiento
 *           de rutas admin no es secreto — el panel es público en el sentido
 *           de discoverability, lo que protegemos es el contenido.
 *
 * D-P17C-2: El audit `access.denied` se hace fire-and-forget para que un
 *           fallo de Prisma no bloquee la redirección — el guard es el
 *           camino crítico, el audit es side-channel.
 */

type AdminAccessContext = {
  /** path solicitado (para el audit log). */
  path?: string
}

async function gatherRequestContext(): Promise<{
  ipAddress: string | null
  userAgent: string | null
  path: string | null
}> {
  try {
    const h = await headers()
    return {
      ipAddress: h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? null,
      userAgent: h.get('user-agent') ?? null,
      path: h.get('x-pathname') ?? null,
    }
  } catch {
    // headers() puede no estar disponible fuera de un request-scope.
    return { ipAddress: null, userAgent: null, path: null }
  }
}

/**
 * Variante "page/layout-friendly": redirige a `/` si el usuario no es
 * SUPER_ADMIN. Devuelve el SessionUser para que la página pueda usar
 * `user.id`/`user.name` sin re-fetch.
 *
 * Pensada para llamarse en `layout.tsx` o `page.tsx` server components.
 */
export async function requireSuperAdmin(
  ctx?: AdminAccessContext,
): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user || !isSuperAdmin(user.roles)) {
    const reqCtx = await gatherRequestContext()
    void recordAuditEventSafe({
      action: 'access.denied',
      entityType: 'admin_panel',
      entityId: null,
      actorId: user?.id ?? null,
      ipAddress: reqCtx.ipAddress,
      userAgent: reqCtx.userAgent,
      metadata: {
        reason: user ? 'INSUFFICIENT_ROLE' : 'UNAUTHENTICATED',
        path: ctx?.path ?? reqCtx.path ?? '/admin',
        roles: user?.roles ?? [],
      },
    })
    redirect('/')
  }
  return user
}

/**
 * Variante "server-action-friendly": lanza `[FORBIDDEN]` si no es
 * SUPER_ADMIN. No redirige — los Server Actions deben fallar con un error
 * tipado para que el caller decida cómo mostrarlo (toast, banner, etc.).
 */
export async function requireSuperAdminOrThrow(
  ctx?: AdminAccessContext,
): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('[UNAUTHORIZED] Sesión requerida')
  }
  if (!isSuperAdmin(user.roles)) {
    const reqCtx = await gatherRequestContext()
    void recordAuditEventSafe({
      action: 'access.denied',
      entityType: 'admin_panel',
      entityId: null,
      actorId: user.id,
      ipAddress: reqCtx.ipAddress,
      userAgent: reqCtx.userAgent,
      metadata: {
        reason: 'INSUFFICIENT_ROLE',
        path: ctx?.path ?? reqCtx.path ?? '/admin',
        roles: user.roles,
      },
    })
    throw new Error('[FORBIDDEN] Solo SUPER_ADMIN puede ejecutar esta acción')
  }
  return user
}

/**
 * Variante "soft" boolean — útil para componentes UI (mostrar/ocultar
 * el botón "Admin Panel" en el menú de usuario). NO usar como guard
 * de seguridad, solo UX.
 */
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  return isSuperAdmin(user.roles)
}
