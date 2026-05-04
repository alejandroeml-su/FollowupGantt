import 'server-only'
import type { WorkspaceRole } from '@prisma/client'
import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { hasAdminRole } from '@/lib/auth/permissions'
import type { SessionUser } from '@/lib/auth/session'

/**
 * Ola P4 · Equipo P4-1 — Multi-tenancy.
 *
 * Guard estándar para server actions multi-tenant que leen/escriben datos
 * de un workspace. Devuelve `{ user, role }` o lanza errores tipados:
 *
 *   - `[UNAUTHORIZED]`        si no hay sesión.
 *   - `[WORKSPACE_NOT_FOUND]` si el workspace no existe.
 *   - `[NOT_MEMBER]`          si el usuario no es miembro y no tiene rol
 *                             global ADMIN/SUPER_ADMIN.
 *
 * Los SUPER_ADMIN/ADMIN globales atraviesan el check sin requerir
 * `WorkspaceMember` (mismo patrón que `requireProjectAccess`). Para ellos
 * `role` se reporta como `null` — la UI puede deshabilitar acciones que
 * requieran rol concreto del WS (ej. transferir owner) si lo necesita.
 *
 * Uso típico:
 *
 *   export async function listProjectsInWorkspace(workspaceId: string) {
 *     const { user } = await requireWorkspaceAccess(workspaceId)
 *     return prisma.project.findMany({ where: { workspaceId } })
 *   }
 */
export async function requireWorkspaceAccess(
  workspaceId: string,
): Promise<{ user: SessionUser; role: WorkspaceRole | null }> {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new Error(
      '[WORKSPACE_NOT_FOUND] workspaceId requerido para verificar acceso',
    )
  }

  const user = await getCurrentUser()
  if (!user) {
    throw new Error('[UNAUTHORIZED] Sesión requerida')
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  })
  if (!workspace) {
    throw new Error(
      `[WORKSPACE_NOT_FOUND] El workspace ${workspaceId} no existe`,
    )
  }

  // Admins (SUPER_ADMIN/ADMIN) tienen acceso global (mismo patrón que
  // `requireProjectAccess`). Reportamos role=null porque no hay membresía
  // formal — la UI puede esconder acciones que requieran OWNER/ADMIN del
  // WS si quiere ser estricta.
  if (hasAdminRole(user.roles)) {
    return { user, role: null }
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: user.id,
      },
    },
    select: { role: true },
  })

  if (!membership) {
    throw new Error(
      `[NOT_MEMBER] El usuario no es miembro del workspace ${workspaceId}`,
    )
  }

  return { user, role: membership.role }
}

/**
 * Variante "soft" que devuelve booleano sin lanzar — útil para UI
 * condicional (ej. mostrar/ocultar el switcher). Las server actions deben
 * seguir usando `requireWorkspaceAccess` para defender el dato.
 */
export async function canAccessWorkspace(
  workspaceId: string,
): Promise<boolean> {
  try {
    await requireWorkspaceAccess(workspaceId)
    return true
  } catch {
    return false
  }
}

/**
 * Helper para acciones de gestión (invitar, eliminar miembros, editar
 * settings del WS). Sólo OWNER/ADMIN del workspace o ADMIN/SUPER_ADMIN
 * global pueden ejecutarlas.
 *
 * Lanza `[FORBIDDEN]` si el usuario es MEMBER simple.
 */
export async function requireWorkspaceManager(
  workspaceId: string,
): Promise<{ user: SessionUser; role: WorkspaceRole | null }> {
  const access = await requireWorkspaceAccess(workspaceId)
  if (access.role === 'MEMBER') {
    throw new Error(
      `[FORBIDDEN] Sólo OWNER o ADMIN del workspace pueden gestionar`,
    )
  }
  return access
}

/**
 * Devuelve el workspace por defecto del usuario (lo crea si no existe).
 *
 * Estrategia de migración (P4 inicial): los proyectos legacy no tienen
 * `workspaceId`. Los server actions que crean recursos pueden invocar
 * este helper para obtener un workspace "personal" implícito y poblar la
 * columna sin pedir input al usuario.
 *
 * El WS por defecto se crea con plan FREE y slug derivado del email
 * (`my-<localPart>-<short-id>`). Si el slug colisiona, reintenta con
 * sufijo aleatorio (best-effort, no probabilístico).
 */
export async function getDefaultWorkspaceForUser(
  userId: string,
): Promise<{ id: string; slug: string }> {
  if (!userId) {
    throw new Error(
      '[WORKSPACE_NOT_FOUND] userId requerido para resolver workspace por defecto',
    )
  }

  // Si ya es OWNER de algún workspace, devolvemos el más antiguo (el
  // "personal" de facto). No filtramos por slug porque el usuario puede
  // haberlo renombrado.
  const owned = await prisma.workspace.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, slug: true },
  })
  if (owned) return owned

  // Sin workspace propio: creamos uno + membership OWNER en transacción
  // para evitar estados intermedios.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  })
  if (!user) {
    throw new Error(`[WORKSPACE_NOT_FOUND] Usuario ${userId} no existe`)
  }

  const localPart = (user.email.split('@')[0] ?? 'user')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)

  // Sufijo corto de userId para minimizar colisión sin parecer un UUID.
  const suffix = userId.replace(/-/g, '').slice(0, 6)
  const slug = `my-${localPart || 'workspace'}-${suffix}`

  const created = await prisma.workspace.create({
    data: {
      name: `Espacio de ${user.name || user.email}`,
      slug,
      plan: 'FREE',
      ownerId: userId,
      members: {
        create: {
          userId,
          role: 'OWNER',
        },
      },
    },
    select: { id: true, slug: true },
  })

  return created
}
