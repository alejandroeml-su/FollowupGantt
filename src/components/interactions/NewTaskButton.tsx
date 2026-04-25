'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { TaskCreationModal } from './TaskCreationModal'
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

  const classes =
    variant === 'primary'
      ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-md'
      : 'bg-card border border-border text-foreground hover:bg-accent'

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${classes}`}
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
