'use client'

/**
 * Wave P9 follow-up demo — Grid jerárquico del Product Backlog.
 *
 * Edwin: "En la vista de product backlog debe de visualizarse desde la
 * epica, historias de usuario, tareas y tareas anidadas relacionadas al
 * product backlog como en un grid."
 *
 * Layout:
 *   [Epic header colapsable, color tag]
 *     ├─ Story / Task raíz (priority, status, SP, assignee)
 *     │   ├─ Subtask
 *     │   │   └─ Sub-sub-task
 *     │   └─ Subtask
 *     └─ ...
 *   [Epic siguiente]
 *
 * Cada nodo es un row con padding-left según depth. Click en chevron
 * expande/colapsa. Tipos diferenciados por icono (Story / Task / Bug).
 */

import { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  BookOpen,
  CheckSquare,
  Bug,
  Sparkles,
  User as UserIcon,
} from 'lucide-react'
import { clsx } from 'clsx'
import type {
  ProductBacklogTreeData,
  ProductBacklogTreeTask,
} from './BacklogClient'

const PRIORITY_TONE: Record<string, string> = {
  CRITICAL: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  HIGH: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  MEDIUM: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  LOW: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
}

const STATUS_TONE: Record<string, string> = {
  TODO: 'bg-slate-500/15 text-slate-300',
  IN_PROGRESS: 'bg-indigo-500/15 text-indigo-300',
  REVIEW: 'bg-violet-500/15 text-violet-300',
  DONE: 'bg-emerald-500/15 text-emerald-300',
}

const STATUS_LABEL: Record<string, string> = {
  TODO: 'Por hacer',
  IN_PROGRESS: 'En curso',
  REVIEW: 'En revisión',
  DONE: 'Completada',
}

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  AGILE_STORY: BookOpen,
  PMI_TASK: CheckSquare,
  ITIL_TICKET: Bug,
}

const TYPE_LABEL: Record<string, string> = {
  AGILE_STORY: 'Historia',
  PMI_TASK: 'Tarea',
  ITIL_TICKET: 'Ticket',
}

const TYPE_TONE: Record<string, string> = {
  AGILE_STORY: 'text-amber-300',
  PMI_TASK: 'text-indigo-300',
  ITIL_TICKET: 'text-rose-300',
}

type Props = {
  groups: ProductBacklogTreeData
}

function countDeep(t: ProductBacklogTreeTask): number {
  return 1 + t.children.reduce((s, c) => s + countDeep(c), 0)
}

export function ProductBacklogTreeGrid({ groups }: Props) {
  if (groups.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <h2 className="text-base font-semibold text-foreground">
          Product Backlog vacío
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Crea Epics y luego Stories sin sprint para verlas aquí agrupadas
          jerárquicamente.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header del grid */}
      <div className="hidden items-center gap-3 border-b border-border pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:flex">
        <span className="w-[40%]">Item</span>
        <span className="w-[10%] text-center">Tipo</span>
        <span className="w-[10%] text-center">Prioridad</span>
        <span className="w-[10%] text-center">Estado</span>
        <span className="w-[8%] text-center">SP</span>
        <span className="w-[15%]">Asignado</span>
      </div>

      {groups.map((group) => (
        <EpicGroup key={group.epicId ?? '__no_epic__'} group={group} />
      ))}
    </div>
  )
}

function EpicGroup({ group }: { group: import('./BacklogClient').ProductBacklogTreeGroup }) {
  const [expanded, setExpanded] = useState(true)
  const totalTasks = group.tasks.reduce((sum, t) => sum + countDeep(t), 0)

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2 text-left hover:bg-secondary/60"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Sparkles
          className="h-4 w-4 shrink-0"
          style={{ color: group.epicColor }}
          aria-hidden
        />
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: group.epicColor }}
          aria-hidden
        />
        <span className="text-sm font-semibold text-foreground">
          {group.epicName}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-input/60 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          {group.tasks.length}{' '}
          {group.tasks.length === 1 ? 'item raíz' : 'items raíz'}
          {totalTasks !== group.tasks.length && (
            <span className="opacity-70">· {totalTasks} total</span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="divide-y divide-border/50">
          {group.tasks.length === 0 ? (
            <p className="px-4 py-3 text-[11px] italic text-muted-foreground">
              Sin items del Product Backlog en esta Epic.
            </p>
          ) : (
            group.tasks.map((t) => <TaskRow key={t.id} task={t} depth={0} />)
          )}
        </div>
      )}
    </section>
  )
}

function TaskRow({
  task,
  depth,
}: {
  task: ProductBacklogTreeTask
  depth: number
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = task.children.length > 0
  const TypeIcon = TYPE_ICON[task.type] ?? CheckSquare
  const typeLabel = TYPE_LABEL[task.type] ?? task.type
  const typeColor = TYPE_TONE[task.type] ?? 'text-muted-foreground'

  return (
    <>
      <div
        className={clsx(
          'flex flex-col gap-2 px-3 py-2 transition-colors hover:bg-secondary/30 md:flex-row md:items-center md:gap-3',
          depth > 0 && 'bg-input/20',
        )}
        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
      >
        {/* Item: chevron + icono tipo + título */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 md:w-[40%]">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary"
              aria-expanded={expanded}
              aria-label={expanded ? 'Contraer' : 'Expandir'}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4" aria-hidden />
          )}
          <TypeIcon className={clsx('h-3.5 w-3.5 shrink-0', typeColor)} />
          {task.mnemonic && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {task.mnemonic}
            </span>
          )}
          <span
            className="truncate text-sm text-foreground"
            title={task.title}
          >
            {task.title}
          </span>
          {hasChildren && (
            <span className="ml-1 text-[10px] text-muted-foreground">
              ({task.children.length})
            </span>
          )}
        </div>

        {/* Tipo */}
        <div className="flex items-center gap-2 md:w-[10%] md:justify-center">
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border border-border bg-input/40 px-1.5 py-0.5 text-[10px]',
              typeColor,
            )}
          >
            {typeLabel}
          </span>
        </div>

        {/* Prioridad */}
        <div className="flex items-center gap-2 md:w-[10%] md:justify-center">
          <span
            className={clsx(
              'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
              PRIORITY_TONE[task.priority] ?? 'border-border text-muted-foreground',
            )}
          >
            {task.priority}
          </span>
        </div>

        {/* Estado */}
        <div className="flex items-center gap-2 md:w-[10%] md:justify-center">
          <span
            className={clsx(
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              STATUS_TONE[task.status] ?? 'bg-secondary text-muted-foreground',
            )}
          >
            {STATUS_LABEL[task.status] ?? task.status}
          </span>
        </div>

        {/* SP */}
        <div className="flex items-center gap-2 md:w-[8%] md:justify-center">
          {task.storyPoints != null ? (
            <span className="text-[11px] font-bold text-foreground">
              {task.storyPoints}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </div>

        {/* Asignado */}
        <div className="flex items-center gap-1.5 md:w-[15%]">
          {task.assignee ? (
            <>
              <UserIcon className="h-3 w-3 text-muted-foreground" />
              <span className="truncate text-[11px] text-foreground">
                {task.assignee.name}
              </span>
            </>
          ) : (
            <span className="text-[10px] italic text-muted-foreground">
              Sin asignar
            </span>
          )}
        </div>
      </div>

      {/* Subtasks recursivas */}
      {hasChildren && expanded && (
        <div>
          {task.children.map((c) => (
            <TaskRow key={c.id} task={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  )
}
