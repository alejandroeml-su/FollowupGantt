'use client'

/**
 * Sprint 5 — Capa delgada que envuelve `<TaskForm mode='edit' />` para el
 * panel lateral de detalle de tarea (`TaskDrawer`). Toda la lógica del
 * formulario vive en `task-form/TaskForm.tsx` (single source of truth).
 *
 * Responsabilidades de esta capa (drawer-only):
 *  - Componer la fila superior con breadcrumbs (TaskBreadcrumbs) + botones
 *    Editar / Guardar — que se inyectan al `TaskForm` vía `renderHeaderLeft`
 *    y `renderHeaderActions` para mantener una sola fila visual igual que
 *    antes del Sprint 5.
 *  - Forwardear `task` + catálogos al `TaskForm`.
 */

import type { SerializedTask } from '@/lib/types'
import { TaskBreadcrumbs } from './TaskDrawer'
import {
  TaskForm,
  TaskFormHeaderActions,
} from './task-form/TaskForm'
import { TaskTimeTrackingSection } from '@/components/time-tracking/TaskTimeTrackingSection'
import { TaskCustomFieldsSection } from '@/components/custom-fields/TaskCustomFieldsSection'
import { TaskGoalsSection } from '@/components/goals/TaskGoalsSection'

type Props = {
  task: SerializedTask
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks?: SerializedTask[]
}

/**
 * Drawer principal de tarea. Compone:
 *   - `<TaskForm mode='edit'/>` (single source of truth de detalle, tabs).
 *   - `<TaskCustomFieldsSection/>` (Ola P1 · Equipo 3) — sólo si la tarea
 *     tiene `projectId`. Renderiza inputs por cada `CustomFieldDef` del
 *     proyecto y autosalva on-blur. Ubicado después del form para no
 *     interferir con la navegación de tabs (los CF aplican a todas las
 *     tabs, conceptualmente "metadatos del proyecto").
 */
export function TaskDrawerContent({ task, projects, users, allTasks = [] }: Props) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TaskForm
        mode="edit"
        task={task}
        projects={projects}
        users={users}
        allTasks={allTasks}
        layout="drawer"
        hideFooter
        renderHeaderLeft={() => (
          <TaskBreadcrumbs
            segments={[
              ...(task.project ? [{ label: task.project.name }] : []),
              { label: `Tarea #${task.mnemonic || task.id.substring(0, 6)}` },
            ]}
          />
        )}
        renderHeaderActions={(ctx) => <TaskFormHeaderActions ctx={ctx} />}
      />
      {/*
       * Ola P1 · Equipo 4 — Sección de Time Tracking. Mientras no haya
       * sesión real, usamos como currentUserId al primer user (mismo
       * patrón que CalendarBoardClient). El userNames aplana la lista
       * de users a un mapa para mostrar autores en la lista.
       */}
      {users[0] ? (
        <div className="border-t border-border bg-card/40 px-6 py-4">
          <TaskTimeTrackingSection
            taskId={task.id}
            currentUserId={task.assigneeId ?? users[0].id}
            userNames={Object.fromEntries(users.map((u) => [u.id, u.name]))}
          />
        </div>
      ) : null}
      {task.projectId && (
        <div className="border-t border-border bg-card/40 px-6 py-4">
          <TaskCustomFieldsSection
            taskId={task.id}
            projectId={task.projectId}
          />
        </div>
      )}
      {/*
       * Ola P2 · Equipo P2-4 — Sección de OKRs. Lista los KRs vinculados
       * a la tarea con el goal padre, ciclo y progreso. Read-only en MVP:
       * los vínculos se gestionan desde /goals.
       */}
      <div className="border-t border-border bg-card/40 px-6 py-4">
        <TaskGoalsSection taskId={task.id} />
      </div>
    </div>
  )
}
