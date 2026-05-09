import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  assertCanViewProject,
  canViewProject,
} from '@/lib/auth/visibility'
import type { SessionUser } from '@/lib/auth/session'

/**
 * Guard estándar para server actions que escriben/leen datos de un
 * proyecto. Devuelve el usuario autenticado o lanza errores tipados:
 *
 *   - `[UNAUTHORIZED]` si no hay sesión válida.
 *   - `[FORBIDDEN]` si el usuario no tiene visibilidad sobre el proyecto.
 *
 * Wave P13 (RBAC visibilidad): delega a `assertCanViewProject` que
 * implementa la matriz jerárquica USER < GERENTE_AREA < GERENCIA_GENERAL
 * < ADMIN < SUPER_ADMIN, con audit log automático en denials.
 *
 * Uso típico:
 *
 *   export async function captureBaseline(input) {
 *     const user = await requireProjectAccess(input.projectId)
 *     // ... resto de la lógica
 *   }
 */
export async function requireProjectAccess(
  projectId: string,
): Promise<SessionUser> {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('[FORBIDDEN] projectId requerido para verificar acceso')
  }

  const user = await getCurrentUser()
  if (!user) {
    throw new Error('[UNAUTHORIZED] Sesión requerida')
  }

  await assertCanViewProject(user, projectId)
  return user
}

/**
 * Variante "soft" que devuelve booleano sin lanzar — útil para UI
 * condicional (ej. mostrar/ocultar botón). Las server actions deben
 * seguir usando `requireProjectAccess` para defender el dato.
 */
export async function canAccessProject(projectId: string): Promise<boolean> {
  const user = await getCurrentUser()
  if (!user) return false
  return canViewProject(user, projectId)
}
