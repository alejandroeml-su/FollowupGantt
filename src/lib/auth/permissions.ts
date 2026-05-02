import 'server-only'

/**
 * Definiciones de roles y permisos básicos del MVP de Auth (Ola P1).
 *
 * El proyecto ya tiene la tabla `Role` con permissions Json (campo libre).
 * Para el MVP solo necesitamos saber si el usuario es ADMIN/SUPER_ADMIN
 * (acceso global) vs AGENTE (necesita ProjectAssignment para escribir).
 *
 * Cuando crezca el RBAC: leer la columna `permissions Json` de Role y
 * mapear a una matriz {action: boolean}. Por ahora basta con el rol.
 */

export const ROLE_NAMES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  AGENTE: 'AGENTE',
} as const

export type RoleName = (typeof ROLE_NAMES)[keyof typeof ROLE_NAMES]

const ADMIN_ROLES: ReadonlySet<string> = new Set<string>([
  ROLE_NAMES.SUPER_ADMIN,
  ROLE_NAMES.ADMIN,
])

export function hasAdminRole(roles: readonly string[]): boolean {
  for (const r of roles) {
    if (ADMIN_ROLES.has(r)) return true
  }
  return false
}

export function isSuperAdmin(roles: readonly string[]): boolean {
  return roles.includes(ROLE_NAMES.SUPER_ADMIN)
}
