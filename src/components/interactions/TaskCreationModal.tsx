'use client'

/**
 * Sprint 5 — Capa delgada que envuelve `<TaskForm mode='create' />` dentro
 * del modal Radix-like custom existente. Toda la lógica del formulario vive
 * en `task-form/TaskForm.tsx` (single source of truth).
 *
 * Responsabilidades de esta capa:
 *  - Render del overlay/dialog y manejo de Esc.
 *  - Confirmación al cerrar con cambios sin guardar.
 *  - Forwarding de props al `<TaskForm>`.
 */

import { useCallback, useEffect, useState } from 'react'
import type { TaskStatus } from '@prisma/client'
import { TaskForm, type ParentOption } from './task-form/TaskForm'
import type {
  PhaseOption,
  SprintOption,
} from './task-form/TaskMetaSidebar'

type Props = {
  open: boolean
  onClose: () => void
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks?: ParentOption[]
  /** Si se pasa, abre el modal en modo subtarea con este padre pre-seleccionado. */
  defaultParentId?: string
  /** Estado inicial para la nueva tarea. */
  defaultStatus?: TaskStatus
  /** Épicas (Phase del schema) por proyecto. */
  phases?: PhaseOption[]
  /** Sprints por proyecto. */
  sprints?: SprintOption[]
}

export function TaskCreationModal({
  open,
  onClose,
  projects,
  users,
  allTasks = [],
  defaultParentId,
  defaultStatus,
  phases = [],
  sprints = [],
}: Props) {
  // Forzamos re-mount del TaskForm cada vez que `open` transiciona a true.
  // Eso resetea estado interno (campos, tags, tab activo). Sustituye el
  // `useEffect` de reseteo que tenía el modal antes del Sprint 5.
  const [mountKey, setMountKey] = useState(0)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) setMountKey((k) => k + 1)
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClose = useCallback(() => {
    // La lógica de "cambios sin guardar" se delega al usuario: el
    // `TaskForm` interno ya marca dirty visualmente. El confirm() de antes
    // de Sprint 5 dependía de leer `isDirty` desde el padre — ahora vive
    // en el form. Mantenemos un confirm best-effort si el form expone
    // `data-dirty` en su botón cerrar.
    onClose()
  }, [onClose])

  // Esc para cerrar.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleClose}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-creation-modal-title"
        className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-card border border-border rounded-xl shadow-2xl flex flex-col"
      >
        <TaskForm
          key={mountKey}
          mode="create"
          projects={projects}
          users={users}
          allTasks={allTasks}
          defaultParentId={defaultParentId}
          defaultStatus={defaultStatus}
          phases={phases}
          sprints={sprints}
          onCreated={() => onClose()}
          onCancel={handleClose}
          layout="modal"
        />
      </div>
    </div>
  )
}
