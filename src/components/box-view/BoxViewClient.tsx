'use client'

/**
 * US-5.1 · Box View Client — grid responsivo de tarjetas por usuario.
 *
 * Hereda el patrón de filtros de `/list` (TaskFiltersBar) para mantener la
 * familiaridad. Los filtros se aplican sobre el universo de tareas de
 * cada usuario y, si tras el filtro un usuario se queda en 0 tareas, su
 * card se oculta (excepto si el filtro `assigneeId` apunta exactamente
 * a él — caso "quiero ver al individuo aunque esté libre").
 */

import { useMemo, useState } from 'react'
import { TaskFiltersBar } from '@/components/interactions/TaskFiltersBar'
import {
  EMPTY_TASK_FILTERS,
  UNASSIGNED_VALUE,
  type TaskFilters,
} from '@/lib/taskFilters'
import { UserBox, type UserBoxTaskView } from './UserBox'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'

export type UserBoxTask = {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  progress: number
  startDate: string | null
  endDate: string | null
  sprintId: string | null
  projectId: string | null
  projectName: string | null
  epicId: string | null
  epicName: string | null
  epicColor: string | null
  estimatedHours: number | null
}

export type UserBoxData = {
  id: string
  name: string
  email: string
  image: string | null
  role: string | null
  activeSprint: {
    id: string
    name: string
    startDate: string
    endDate: string
  } | null
  topEpic: {
    id: string
    name: string
    color: string
  } | null
  tasks: UserBoxTask[]
}

type Props = {
  users: UserBoxData[]
  projects: { id: string; name: string; areaId?: string | null }[]
  gerencias: { id: string; name: string }[]
  areas: { id: string; name: string; gerenciaId?: string | null }[]
  allUsers: { id: string; name: string }[]
  /** Reservado: identidad para futuras integraciones (presence en cards). */
  currentUser: CurrentUserPresence | null
}

function taskMatches(task: UserBoxTask, f: TaskFilters): boolean {
  if (f.projectId && task.projectId !== f.projectId) return false
  if (f.status && task.status !== f.status) return false
  if (f.priority && task.priority !== f.priority) return false
  if (f.epicId) {
    if (f.epicId === '__no_epic__') {
      if (task.epicId) return false
    } else if (task.epicId !== f.epicId) {
      return false
    }
  }
  if (f.dateFrom || f.dateTo) {
    const start = task.startDate ? Date.parse(task.startDate) : null
    const end = task.endDate ? Date.parse(task.endDate) : null
    if (start === null && end === null) return false
    const effStart = start ?? Number.NEGATIVE_INFINITY
    const effEnd = end ?? Number.POSITIVE_INFINITY
    const f0 = f.dateFrom
      ? Date.parse(`${f.dateFrom}T00:00:00.000Z`)
      : Number.NEGATIVE_INFINITY
    const f1 = f.dateTo
      ? Date.parse(`${f.dateTo}T23:59:59.999Z`)
      : Number.POSITIVE_INFINITY
    if (!(effStart <= f1 && effEnd >= f0)) return false
  }
  return true
}

export function BoxViewClient({
  users,
  projects,
  gerencias,
  areas,
  allUsers,
}: Props) {
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)

  // 2026-05-16 · US-5.1 — el filtro de assignee se interpreta a nivel
  // *card* (oculta cards que no coincidan), no a nivel tarea. Los demás
  // filtros se aplican dentro del universo de cada usuario.
  const visibleUsers = useMemo(() => {
    const assigneeFilter = filters.assigneeId
    return users
      .filter((u) => {
        if (!assigneeFilter) return true
        if (assigneeFilter === UNASSIGNED_VALUE) return false
        return u.id === assigneeFilter
      })
      .map((u) => {
        const filteredTasks = u.tasks.filter((t) => taskMatches(t, filters))
        return { user: u, tasks: filteredTasks }
      })
      .filter(({ user, tasks }) => {
        // Si el filtro apunta exactamente a un usuario, mostramos su
        // card aunque no tenga tareas (UX: confirmar "está libre").
        if (filters.assigneeId && filters.assigneeId === user.id) return true
        return tasks.length > 0
      })
  }, [users, filters])

  return (
    <>
      <TaskFiltersBar
        value={filters}
        onChange={setFilters}
        projects={projects}
        gerencias={gerencias}
        areas={areas}
        users={allUsers}
        // No tiene sentido filtrar por type/methodology en una vista de
        // capacidad por persona; tampoco por gerencia (lo ofrece el page).
        show={{
          gerenciaId: true,
          areaId: true,
          projectId: true,
          status: true,
          priority: true,
          assigneeId: true,
          dateFrom: true,
          dateTo: true,
          type: false,
          epicId: false,
        }}
      />

      {visibleUsers.length === 0 ? (
        <div
          role="status"
          className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground"
        >
          No hay miembros con carga activa que coincidan con los filtros.
        </div>
      ) : (
        <div
          data-testid="box-view-grid"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {visibleUsers.map(({ user, tasks }) => (
            <UserBox
              key={user.id}
              user={user}
              tasks={tasks as UserBoxTaskView[]}
            />
          ))}
        </div>
      )}
    </>
  )
}
