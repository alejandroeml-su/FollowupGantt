import 'server-only'

/**
 * Wave P13 (RBAC visibilidad de proyectos) — control central server-side.
 *
 * Implementa la matriz de visibilidad jerárquica:
 *
 *   ┌──────────────────┬─────────┬──────────┬─────────┬─────────┬────────┐
 *   │ Rol              │ Asign.  │ Gerencia │ Espacio │ Otros   │ Config │
 *   ├──────────────────┼─────────┼──────────┼─────────┼─────────┼────────┤
 *   │ USER (AGENTE)    │   ✓     │    ✓*    │   —     │   —     │   —    │
 *   │ GERENTE_AREA     │   ✓     │    ✓     │   —     │   —     │   —    │
 *   │ GERENCIA_GENERAL │   ✓     │    ✓     │   ✓     │   —     │   —    │
 *   │ ADMIN            │   ✓     │    ✓     │   ✓     │   ✓     │   —    │
 *   │ SUPER_ADMIN      │   ✓     │    ✓     │   ✓     │   ✓     │   ✓    │
 *   └──────────────────┴─────────┴──────────┴─────────┴─────────┴────────┘
 *
 *   *USER ve los proyectos de su Gerencia base (criterio 1 de la HU
 *   "Acceso Transversal por Asignación") + los proyectos externos a los
 *   que está explícitamente asignado vía ProjectAssignment. Otros
 *   proyectos de gerencias ajenas siguen ocultos.
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

  // Cláusulas de "asignación directa al proyecto" — comunes a GERENTE_AREA
  // y USER. Edwin reportó 2026-05-13 que tener una *tarea* asignada en un
  // proyecto ajeno no era suficiente para ver el proyecto. La regla de
  // negocio real es: si el usuario tiene cualquier vínculo de trabajo con
  // el proyecto (membresía formal, equipo, asignación de tarea, o
  // colaboración en una tarea), debe verlo. Ampliamos el OR.
  const directAccessClauses: Prisma.ProjectWhereInput[] = [
    { assignments: { some: { userId: user.id } } },
    { teamProjects: { some: { team: { members: { some: { userId: user.id } } } } } },
    // 2026-05-13 · Edwin — tarea asignada al usuario dentro del proyecto.
    { tasks: { some: { assigneeId: user.id, archivedAt: null } } },
    // 2026-05-13 · Edwin — colaborador en alguna tarea del proyecto.
    {
      tasks: {
        some: {
          archivedAt: null,
          collaborators: { some: { userId: user.id } },
        },
      },
    },
  ]

  // 3. Por gerencia · GERENTE_AREA ve proyectos cuyo área pertenece a su gerencia.
  //    Si no tiene gerencia asignada, cae al alcance de USER.
  if (canViewOwnGerencia(roles) && user.gerenciaId) {
    return {
      AND: [
        wsScope,
        {
          OR: [
            { area: { gerenciaId: user.gerenciaId } },
            ...directAccessClauses,
          ],
        },
      ],
    }
  }

  // 4. USER · gerencia base + asignación directa cross-gerencia + equipos.
  //    HU "Acceso Transversal por Asignación de Proyecto" (2026-05-12):
  //    el usuario debe ver por defecto su gerencia base y, como excepción,
  //    los proyectos de OTRAS gerencias donde tiene asignación explícita.
  //    Sin gerencia base (`user.gerenciaId` nulo) cae al comportamiento
  //    legacy de "solo proyectos asignados".
  const orClauses: Prisma.ProjectWhereInput[] = [...directAccessClauses]
  if (user.gerenciaId) {
    orClauses.push({ area: { gerenciaId: user.gerenciaId } })
  }
  return {
    AND: [wsScope, { OR: orClauses }],
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

/**
 * Devuelve un `Prisma.TaskWhereInput` que limita las tareas a los proyectos
 * visibles para el usuario. Pensado para los listados globales (`/list`,
 * `/gantt`, `/timeline`, `/kanban`, `/calendar`) que cargan tareas sin
 * filtro de proyecto explícito y, antes de esta HU, exponían tareas de
 * todas las gerencias a cualquier usuario autenticado.
 *
 * El filtro devuelve `{ projectId: { in: [] } }` cuando no hay proyectos
 * visibles, lo que efectivamente vacía el resultado sin lanzar.
 *
 * Para SUPER_ADMIN/ADMIN devuelve `{}` (sin restricción) porque
 * `getProjectAccessFilter` ya retornó `{}` y no tendría sentido el `IN`.
 */
export async function getTaskAccessFilter(
  user: SessionUser & {
    gerenciaId?: string | null
    workspaceId?: string | null
  },
): Promise<Prisma.TaskWhereInput> {
  const projectFilter = await getProjectAccessFilter(user)
  // Si el filtro de proyectos es `{}` el usuario es ADMIN/SUPER_ADMIN: no
  // restringimos tareas. `Object.keys` cubre `{ AND: [{...}] }` y `{}`.
  if (Object.keys(projectFilter).length === 0) {
    return {}
  }
  const visibleIds = await getVisibleProjectIds(user)
  if (visibleIds.length === 0) {
    return { projectId: { in: [] } }
  }
  return { projectId: { in: visibleIds } }
}

/**
 * Resuelve la visibilidad de proyectos en una sola pasada y devuelve los
 * insumos que los listados globales necesitan:
 *
 *   - `unrestricted: true` para ADMIN/SUPER_ADMIN (sin filtros).
 *   - `unrestricted: false, visibleIds: [...]` para el resto.
 *   - `unrestricted: false, visibleIds: []` si no hay sesión.
 *
 * Los callers consumen:
 *   - `taskWhere`: spread en `prisma.task.findMany({ where: {...} })`.
 *   - `projectWhere`: spread en `prisma.project.findMany({ where: {...} })`.
 *
 * Pensado para reducir boilerplate y centralizar el comportamiento de la
 * HU "Acceso Transversal por Asignación de Proyecto" en todas las pages.
 */
export async function resolveProjectVisibility(
  user:
    | (SessionUser & {
        gerenciaId?: string | null
        workspaceId?: string | null
      })
    | null,
): Promise<{
  unrestricted: boolean
  visibleIds: string[]
  taskWhere: Prisma.TaskWhereInput
  projectWhere: Prisma.ProjectWhereInput
}> {
  if (!user) {
    return {
      unrestricted: false,
      visibleIds: [],
      taskWhere: { projectId: { in: [] } },
      projectWhere: { id: { in: [] } },
    }
  }
  const projectFilter = await getProjectAccessFilter(user)
  if (Object.keys(projectFilter).length === 0) {
    return {
      unrestricted: true,
      visibleIds: [],
      taskWhere: {},
      projectWhere: {},
    }
  }
  const visibleIds = await getVisibleProjectIds(user)
  if (visibleIds.length === 0) {
    return {
      unrestricted: false,
      visibleIds: [],
      taskWhere: { projectId: { in: [] } },
      projectWhere: { id: { in: [] } },
    }
  }
  return {
    unrestricted: false,
    visibleIds,
    taskWhere: { projectId: { in: visibleIds } },
    projectWhere: { id: { in: visibleIds } },
  }
}
