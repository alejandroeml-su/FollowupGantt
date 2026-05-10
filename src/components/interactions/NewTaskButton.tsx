'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { TaskCreationModal } from './TaskCreationModal'
import { useUIStore } from '@/lib/stores/ui'
import type { SerializedTask } from '@/lib/types'
import type {
  PhaseOption,
  SprintOption,
} from './task-form/TaskMetaSidebar'

type ParentOption = Pick<SerializedTask, 'id' | 'title' | 'mnemonic'> & {
  project?: { id: string; name: string } | null
  projectId?: string
}

type Props = {
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks?: ParentOption[]
  /** Épicas (Phase del schema) — se filtran por proyecto en la sidebar. */
  phases?: PhaseOption[]
  /** Sprints — se filtran por proyecto en la sidebar. */
  sprints?: SprintOption[]
  variant?: 'primary' | 'subtle'
  label?: string
}

export function NewTaskButton({
  projects,
  users,
  allTasks = [],
  phases = [],
  sprints = [],
  variant = 'primary',
  label = 'Nueva Tarea',
}: Props) {
  const [open, setOpen] = useState(false)
  const requestedAt = useUIStore((s) => s.newTaskRequestedAt)
  // Wave P16-C — atajo global `cmd+shift+n` dispara `requestNewTask()`
  // bumpeando `newTaskRequestedAt`. Cualquier `<NewTaskButton/>` montado
  // en la página abre su modal en la siguiente render. Si hay varios
  // botones (raro), todos abren — el primero que cierra "consume" el
  // request (vía `lastSeenRef`), el resto se ignora.
  const lastSeenRef = useRef<number | null>(null)
  useEffect(() => {
    if (!requestedAt) return
    if (lastSeenRef.current === requestedAt) return
    lastSeenRef.current = requestedAt
    setOpen(true)
  }, [requestedAt])

  const classes =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-md'
      : 'bg-card border border-border text-foreground hover:bg-accent'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-tour-target="new-task"
        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors min-h-[44px] sm:min-h-0 ${classes}`}
      >
        <Plus className="h-4 w-4" />
        {label}
      </button>
      <TaskCreationModal
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        users={users}
        allTasks={allTasks}
        phases={phases}
        sprints={sprints}
      />
    </>
  )
}
