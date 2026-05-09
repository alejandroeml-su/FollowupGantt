import 'server-only'

/**
 * Wave P13 (RBAC visibilidad de proyectos) — control central server-side.
 *
 * Implementa la matriz de visibilidad jerárquica:
 *
 *   ┌──────────────────┬─────────┬──────────┬─────────┬─────────┬────────┐
 *   │ Rol              │ Asign.  │ Gerencia │ Espacio │ Otros   │ Config │
 *   ├──────────────────┼─────────┼──────────┼─────────┼─────────┼────────┤
 *   │ USER (AGENTE)    │   ✓     │    —     │   —     │   —     │   —    │
 *   │ GERENTE_AREA     │   ✓     │    ✓     │   —     │   —     │   —    │
 *   │ GERENCIA_GENERAL │   ✓     │    ✓     │   ✓     │   —     │   —    │
 *   │ ADMIN            │   ✓     │    ✓     │   ✓     │   ✓     │   —    │
 *   │ SUPER_ADMIN      │   ✓     │    ✓     │   ✓     │   ✓     │   ✓    │
 *   └──────────────────┴─────────┴──────────┴─────────┴─────────┴────────┘
 *
 * Cada rol hereda los permisos del rol inferior y agrega un nuevo alcance.
 *
 * Estrategia técnica:
 *   - `getProjectAccessFilter(user)` devuelve un `Prisma.ProjectWhereInput`
 *     que se inyecta en cualquier `prisma.project.findMany/count/findFirst`.
 *   - `canViewProject(user, projectId)` valida acceso a un proyecto puntual
 *     y registra `access.denied` en audit log si falla.
 *   - `assertCanViewProject` lanza `[FORBIDDEN]` si no hay acceso.
 *
 * Diseño anti-circumvention:
 *   - No depende de filtros de cliente.
 *   - El filtro va a la BD vía Prisma; URL directa también queda bloqueada
 *     porque server actions/server components reusan el mismo helper.
 *   - Audit log capturado por cada denial para compliance.
 */

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  canViewAllWorkspaces,
  canViewOwnGerencia,
  canViewWholeWorkspace,
} from '@/lib/auth/permissions'
import type { SessionUser } from '@/lib/auth/session'

/**
 * Devuelve un filtro `where` para `prisma.project` que limita la query
 * a los proyectos visibles para el usuario.
 *
 * - SUPER_ADMIN/ADMIN: filtro `{}` (ven todo, todos los workspaces).
 * - GERENCIA_GENERAL: limitado al workspace activo.
 * - GERENTE_AREA: workspace activo + área dentro de su gerencia + asignados/equipo.
 * - USER (incluye AGENTE legacy): solo workspace activo + asignados o equipo.
 *
 * @param user usuario autenticado (con `roles[]` y `gerenciaId`/workspaceId).
 */
export async function getProjectAccessFilter(
  user: SessionUser & { gerenciaId?: string | null; workspaceId?: string | null },
): Promise<Prisma.ProjectWhereInput> {
  const roles = user.roles ?? []

  // 1. Acceso global · SUPER_ADMIN/ADMIN ven todos los workspaces.
  if (canViewAllWorkspaces(roles)) {
    return {}
  }

  const workspaceId = user.workspaceId ?? undefined
  const wsScope: Prisma.ProjectWhereInput = workspaceId
    ? { workspaceId }
    : {}

  // 2. Workspace completo · GERENCIA_GENERAL ve todo del WS activo.
  if (canViewWholeWorkspace(roles)) {
    return wsScope
  }

  // 3. Por gerencia · GERENTE_AREA ve proyectos cuyo área pertenece a su gerencia.
  //    Si no tiene gerencia asignada, cae al alcance de USER.
  if (canViewOwnGerencia(roles) && user.gerenciaId) {
    return {
      AND: [
        wsScope,
        {
          OR: [
            { area: { gerenciaId: user.gerenciaId } },
            { assignments: { some: { userId: user.id } } },
            { teamProjects: { some: { team: { members: { some: { userId: user.id } } } } } },
          ],
        },
      ],
    }
  }

  // 4. USER · solo asignación directa o por equipo, dentro del WS activo.
  return {
    AND: [
      wsScope,
      {
        OR: [
          { assignments: { some: { userId: user.id } } },
          { teamProjects: { some: { team: { members: { some: { userId: user.id } } } } } },
        ],
      },
    ],
  }
}

/**
 * Valida si un usuario puede ver un proyecto específico. Útil para
 * páginas/server-actions que reciben `projectId` por URL o param y
 * necesitan validar acceso antes de exponer datos.
 *
 * Si el acceso es denegado registra un evento `access.denied` en el
 * audit log con el `entityId` del proyecto solicitado.
 */
export async function canViewProject(
  user: SessionUser & { gerenciaId?: string | null; workspaceId?: string | null },
  projectId: string,
): Promise<boolean> {
  const filter = await getProjectAccessFilter(user)

  const found = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, filter] },
    select: { id: true },
  })

  if (!found) {
    await recordAuditEventSafe({
      action: 'access.denied',
      entityType: 'project',
      entityId: projectId,
      actorId: user.id,
      metadata: {
        reason: 'project_not_visible_for_role',
        roles: user.roles,
      },
    })
    return false
  }

  return true
}

/**
 * Variante que lanza `[FORBIDDEN]` cuando no se tiene acceso. Pensada
 * para usar como guard en server actions/pages.
 */
export async function assertCanViewProject(
  user: SessionUser & { gerenciaId?: string | null; workspaceId?: string | null },
  projectId: string,
): Promise<void> {
  const ok = await canViewProject(user, projectId)
  if (!ok) {
    throw new Error(
      `[FORBIDDEN] El usuario no tiene visibilidad sobre el proyecto ${projectId}`,
    )
  }
}

/**
 * Lista los IDs de proyectos visibles. Útil para queries cross-project
 * (allocation, portfolio) que necesitan filtrar `IN (...)`.
 */
export async function getVisibleProjectIds(
  user: SessionUser & { gerenciaId?: string | null; workspaceId?: string | null },
): Promise<string[]> {
  const filter = await getProjectAccessFilter(user)
  const projects = await prisma.project.findMany({
    where: filter,
    select: { id: true },
  })
  return projects.map((p) => p.id)
}
