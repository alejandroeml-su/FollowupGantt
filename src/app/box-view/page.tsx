/**
 * US-5.1 · Box View (R3 final) — vista de capacidad individual.
 *
 * Diferenciación contra `/workload`:
 *  - Workload = heatmap user × semana (12 semanas) con utilización.
 *  - Box View = una tarjeta por persona con sus KPIs de iteración:
 *    activas, done en sprint actual, atrasadas, mini-barra de capacidad,
 *    sprint vigente, epic activa y top-5 de tareas con click → drawer.
 *
 * Toda la query pasa por `resolveProjectVisibility` (RBAC obligatorio
 * de la wave P13). El client recibe sólo los DTOs que necesita pintar.
 */

import prisma from '@/lib/prisma'
import { Users } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { resolveProjectVisibility } from '@/lib/auth/visibility'
import { BoxViewClient, type UserBoxData } from '@/components/box-view/BoxViewClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'

export const dynamic = 'force-dynamic'

type ScrumAttrs = { hoursEstimate?: number | string | null } | null | undefined

function extractEstimatedHours(scrumAttributes: unknown): number | null {
  // 2026-05-16 · US-5.1 — los atributos de scrum se guardan como Json sin
  // schema en BD; algunos snapshots vienen con `hoursEstimate` como string.
  // Normalizamos defensivamente sin importar el helper completo (la card
  // sólo necesita el número, no la validación end-to-end).
  if (!scrumAttributes || typeof scrumAttributes !== 'object') return null
  const sa = scrumAttributes as ScrumAttrs
  const raw = sa?.hoursEstimate
  if (raw == null) return null
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export default async function BoxViewPage() {
  // RBAC obligatorio — sin sesión, no exponemos datos.
  const sessionUser = await getCurrentUser()
  const currentUser = await getCurrentUserPresence()
  const visibility = await resolveProjectVisibility(sessionUser)

  // Cargamos sólo los usuarios que tienen al menos una tarea activa en
  // los proyectos visibles. Para "ver al equipo completo" un Resource
  // Manager generalmente quiere foco en quien actualmente está cargado.
  // Si no hay sesión visibility ya devolvió listas vacías → users=[].
  const usersDb = await prisma.user.findMany({
    where: {
      tasks: {
        some: {
          AND: [
            { archivedAt: null },
            visibility.taskWhere,
          ],
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      roles: {
        select: { role: { select: { name: true } } },
      },
      tasks: {
        where: {
          AND: [{ archivedAt: null }, visibility.taskWhere],
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          progress: true,
          startDate: true,
          endDate: true,
          sprintId: true,
          scrumAttributes: true,
          project: { select: { id: true, name: true } },
          epic: { select: { id: true, name: true, color: true } },
          sprint: {
            select: {
              id: true,
              name: true,
              status: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  // Catálogos para filtros (mismas listas que /list, restringidas por RBAC).
  const [projects, gerencias, areas, allUsers] = await Promise.all([
    prisma.project.findMany({
      where: visibility.projectWhere,
      select: { id: true, name: true, areaId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.gerencia.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.area.findMany({
      select: { id: true, name: true, gerenciaId: true },
      orderBy: { name: 'asc' },
    }),
    // El filtro de "asignado" debería listar a *cualquier* usuario, no
    // sólo los que ya aparecen como cards (uno puede querer ver el card
    // vacío de un colaborador sin carga, aunque por default no aparezca).
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const now = new Date()

  const data: UserBoxData[] = usersDb.map((u) => {
    const tasks = u.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      progress: t.progress,
      startDate: t.startDate ? t.startDate.toISOString() : null,
      endDate: t.endDate ? t.endDate.toISOString() : null,
      sprintId: t.sprintId,
      projectId: t.project?.id ?? null,
      projectName: t.project?.name ?? null,
      epicId: t.epic?.id ?? null,
      epicName: t.epic?.name ?? null,
      epicColor: t.epic?.color ?? null,
      estimatedHours: extractEstimatedHours(t.scrumAttributes),
    }))

    // Sprint activo del usuario: si tiene una tarea no DONE en un
    // Sprint con status=ACTIVE y rango que contenga "now", lo elegimos.
    // Si hay varios (cross-project), tomamos el primero (todos cuentan
    // como "en iteración" desde la perspectiva de la persona).
    const activeSprint = u.tasks
      .map((t) => t.sprint)
      .find(
        (s): s is NonNullable<typeof s> =>
          s != null &&
          s.status === 'ACTIVE' &&
          s.startDate.getTime() <= now.getTime() &&
          s.endDate.getTime() >= now.getTime(),
      )

    // Epic activa = la epic con más tareas no DONE; desempate por nombre.
    const epicCounts = new Map<string, { id: string; name: string; color: string; count: number }>()
    for (const t of u.tasks) {
      if (!t.epic) continue
      if (t.status === 'DONE') continue
      const prev = epicCounts.get(t.epic.id)
      if (prev) prev.count += 1
      else
        epicCounts.set(t.epic.id, {
          id: t.epic.id,
          name: t.epic.name,
          color: t.epic.color,
          count: 1,
        })
    }
    const topEpic = [...epicCounts.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    )[0]

    // Rol "presentable" — tomamos el primero (las cards no son admin UI).
    const roleName = u.roles[0]?.role?.name ?? null

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      role: roleName,
      activeSprint: activeSprint
        ? {
            id: activeSprint.id,
            name: activeSprint.name,
            startDate: activeSprint.startDate.toISOString(),
            endDate: activeSprint.endDate.toISOString(),
          }
        : null,
      topEpic: topEpic
        ? { id: topEpic.id, name: topEpic.name, color: topEpic.color }
        : null,
      tasks,
    }
  })

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-foreground">
            <Users className="h-6 w-6 text-indigo-400" aria-hidden />
            Box View
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Capacidad individual por miembro · progreso, sprint y epic activos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher />
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4 custom-scrollbar">
        <BoxViewClient
          users={data}
          projects={projects}
          gerencias={gerencias}
          areas={areas}
          allUsers={allUsers}
          currentUser={currentUser}
        />
      </div>
    </div>
  )
}
