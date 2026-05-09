import 'server-only'

/**
 * Definiciones de roles y permisos básicos.
 *
 * Wave P1 inicial: SUPER_ADMIN/ADMIN/AGENTE.
 * Wave P13 extiende a la jerarquía de visibilidad de proyectos:
 *
 *   USER < GERENTE_AREA < GERENCIA_GENERAL < ADMIN < SUPER_ADMIN
 *
 * Cada rol hereda los permisos del rol inferior y agrega un nuevo alcance.
 * AGENTE legacy sigue siendo equivalente a USER.
 */

export const ROLE_NAMES = {
  // Wave P13 (jerarquía formal)
  USER:             'USER',
  GERENTE_AREA:     'GERENTE_AREA',
  GERENCIA_GENERAL: 'GERENCIA_GENERAL',
  ADMIN:            'ADMIN',
  SUPER_ADMIN:      'SUPER_ADMIN',
  // Legacy (Wave P1) — equivalente a USER. Permanece por compat.
  AGENTE:           'AGENTE',
} as const

export type RoleName = (typeof ROLE_NAMES)[keyof typeof ROLE_NAMES]

const ADMIN_ROLES: ReadonlySet<string> = new Set<string>([
  ROLE_NAMES.SUPER_ADMIN,
  ROLE_NAMES.ADMIN,
])

const GLOBAL_VIEW_ROLES: ReadonlySet<string> = new Set<string>([
  ROLE_NAMES.SUPER_ADMIN,
  ROLE_NAMES.ADMIN,
])

const WORKSPACE_VIEW_ROLES: ReadonlySet<string> = new Set<string>([
  ROLE_NAMES.SUPER_ADMIN,
  ROLE_NAMES.ADMIN,
  ROLE_NAMES.GERENCIA_GENERAL,
])

const GERENCIA_VIEW_ROLES: ReadonlySet<string> = new Set<string>([
  ROLE_NAMES.SUPER_ADMIN,
  ROLE_NAMES.ADMIN,
  ROLE_NAMES.GERENCIA_GENERAL,
  ROLE_NAMES.GERENTE_AREA,
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

/**
 * Wave P13 · puede ver proyectos de cualquier workspace ("Otros espacios"
 * en la matriz). Solo ADMIN/SUPER_ADMIN.
 */
export function canViewAllWorkspaces(roles: readonly string[]): boolean {
  for (const r of roles) {
    if (GLOBAL_VIEW_ROLES.has(r)) return true
  }
  return false
}

/**
 * Wave P13 · puede ver todos los proyectos del workspace activo
 * ("Todo el espacio"). GERENCIA_GENERAL + ADMIN + SUPER_ADMIN.
 */
export function canViewWholeWorkspace(roles: readonly string[]): boolean {
  for (const r of roles) {
    if (WORKSPACE_VIEW_ROLES.has(r)) return true
  }
  return false
}

/**
 * Wave P13 · puede ver proyectos de su gerencia ("De su gerencia").
 * GERENTE_AREA + superiores.
 */
export function canViewOwnGerencia(roles: readonly string[]): boolean {
  for (const r of roles) {
    if (GERENCIA_VIEW_ROLES.has(r)) return true
  }
  return false
}

/**
 * Wave P13 · puede gestionar configuración del sistema (Roles, Permisos,
 * Workspaces, parámetros globales). Solo SUPER_ADMIN.
 */
export function canConfigureSystem(roles: readonly string[]): boolean {
  return isSuperAdmin(roles)
}
