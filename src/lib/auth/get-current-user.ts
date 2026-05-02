import 'server-only'
import { getSession, type SessionUser } from '@/lib/auth/session'

/**
 * Devuelve el usuario autenticado o `null`. Wrapper delgado sobre
 * `getSession` para alinearse con la nomenclatura sugerida por la doc
 * Next.js (DAL · Data Access Layer).
 *
 * No usa `cache()` de React aquí porque el ciclo de la cookie ya nos da
 * por-request memoization implícita (la cookie no cambia durante un
 * render). Si se demuestra que la query DB pesa, envolvemos con
 * `cache(getCurrentUser)` en una iteración futura.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  return getSession()
}

/**
 * Variante estricta: lanza `[UNAUTHORIZED]` si no hay sesión. Útil para
 * server actions que SIEMPRE requieren autenticación (no leen datos
 * públicos).
 */
export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser()
  if (!u) {
    throw new Error('[UNAUTHORIZED] Sesión requerida')
  }
  return u
}
