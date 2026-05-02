/**
 * Punto de entrada público del módulo Auth (Ola P1 · MVP).
 *
 * Mantiene una API similar a NextAuth v5 (`auth()`, `signIn()`,
 * `signOut()`) para minimizar la fricción de migración cuando se
 * incorpore el adapter Prisma + providers SSO.
 */

export { getCurrentUser, requireUser } from './get-current-user'
export {
  requireProjectAccess,
  canAccessProject,
} from './check-project-access'
export {
  hasAdminRole,
  isSuperAdmin,
  ROLE_NAMES,
  type RoleName,
} from './permissions'
export type { SessionUser } from './session'
export { SESSION_COOKIE_NAME } from './session'

// Re-export con nombres NextAuth-compatibles para futura migración.
export { getCurrentUser as auth } from './get-current-user'
export { loginAction as signIn, logoutAction as signOut } from './actions'
