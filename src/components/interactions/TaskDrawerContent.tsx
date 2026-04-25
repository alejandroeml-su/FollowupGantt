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

type Props = {
  task: SerializedTask
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks?: SerializedTask[]
}

export function TaskDrawerContent({ task, projects, users, allTasks = [] }: Props) {
  return (
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
  )
}
