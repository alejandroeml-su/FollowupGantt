import 'server-only'
import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { hasAdminRole } from '@/lib/auth/permissions'
import type { SessionUser } from '@/lib/auth/session'

/**
 * Guard estándar para server actions que escriben/leen datos de un
 * proyecto. Devuelve el usuario autenticado o lanza errores tipados:
 *
 *   - `[UNAUTHORIZED]` si no hay sesión válida.
 *   - `[FORBIDDEN]` si el usuario no es ADMIN/SUPER_ADMIN y no tiene
 *     `ProjectAssignment` para `projectId`.
 *
 * Diseñado para ser barato: una sola query a `ProjectAssignment` cuando
 * el usuario no es admin. Cachear en futuro con `cache()` si el mismo
 * render dispara N actions sobre el mismo proyecto.
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

  // Admins (SUPER_ADMIN/ADMIN) tienen acceso global a todos los proyectos.
  if (hasAdminRole(user.roles)) {
    return user
  }

  const assignment = await prisma.projectAssignment.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: user.id,
      },
    },
    select: { projectId: true },
  })

  if (!assignment) {
    throw new Error(
      `[FORBIDDEN] El usuario no tiene acceso al proyecto ${projectId}`,
    )
  }

  return user
}

/**
 * Variante "soft" que devuelve booleano sin lanzar — útil para UI
 * condicional (ej. mostrar/ocultar botón). Las server actions deben
 * seguir usando `requireProjectAccess` para defender el dato.
 */
export async function canAccessProject(projectId: string): Promise<boolean> {
  try {
    await requireProjectAccess(projectId)
    return true
  } catch {
    return false
  }
}
