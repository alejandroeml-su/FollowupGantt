'use client'

import { Calendar, Flag, UserCircle2 } from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import StatusSelector from '@/components/StatusSelector'
import { TaskBreadcrumbs } from './TaskDrawer'

/**
 * Contenido del Drawer lateral para una tarea.
 * Muestra breadcrumbs, título, estado, asignado, fecha, prioridad y descripción.
 * Sprint 1: minimal read-only salvo el selector de estado (reutiliza el existente).
 */
export function TaskDrawerContent({ task }: { task: SerializedTask }) {
  const dateStr = task.endDate
    ? new Date(task.endDate).toLocaleDateString()
    : 'Sin fecha'

  return (
    <article aria-labelledby={`drawer-title-${task.id}`} className="space-y-5">
      <TaskBreadcrumbs
        segments={[
          ...(task.project ? [{ label: task.project.name }] : []),
          { label: `Tarea #${task.id.substring(0, 6)}` },
        ]}
      />

      <h2
        id={`drawer-title-${task.id}`}
        className="text-lg font-semibold leading-snug text-slate-100"
      >
        {task.title}
      </h2>

      <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
        <dt className="flex items-center gap-2 text-slate-500">
          <span className="h-2 w-2 rounded-full bg-slate-500" /> Estado
        </dt>
        <dd>
          <StatusSelector taskId={task.id} currentStatus={task.status} />
        </dd>

        <dt className="flex items-center gap-2 text-slate-500">
          <UserCircle2 className="h-3.5 w-3.5" /> Asignado
        </dt>
        <dd className="text-slate-200">
          {task.assignee?.name ?? 'Sin asignar'}
        </dd>

        <dt className="flex items-center gap-2 text-slate-500">
          <Calendar className="h-3.5 w-3.5" /> Fecha límite
        </dt>
        <dd className="text-slate-200">{dateStr}</dd>

        <dt className="flex items-center gap-2 text-slate-500">
          <Flag className="h-3.5 w-3.5" /> Prioridad
        </dt>
        <dd className="text-slate-200">{task.priority}</dd>
      </dl>

      {task.description && (
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            Descripción
          </h3>
          <p className="whitespace-pre-wrap text-sm text-slate-300">
            {task.description}
          </p>
        </section>
      )}

      {!!task.subtasks?.length && (
        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Subtareas ({task.subtasks.length})
          </h3>
          <ul className="space-y-1">
            {task.subtasks.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              >
                <span className="truncate text-slate-200">{s.title}</span>
                <span className="text-xs text-slate-500">{s.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
