'use client'

import { useMemo } from 'react'
import { clsx } from 'clsx'
import type { TaskStatus } from '@prisma/client'
import { StatusPills } from './StatusPills'

export type PhaseOption = {
  id: string
  name: string
  projectId: string
}

export type SprintOption = {
  id: string
  name: string
  projectId: string
}

export type TaskMetaState = {
  status: TaskStatus
  assigneeId: string
  projectId: string
  phaseId: string
  sprintId: string
  isMilestone: boolean
  startDate: string
  endDate: string
  /** Estimación en horas (campo `plannedValue` del schema). */
  plannedValue: string
}

type Props = {
  /**
   * `create`: usado dentro del modal de creación (Sprint 1).
   * `edit`: reservado para Sprint 2+ (drawer de edición).
   * Nota: en Sprint 1 sólo se renderiza `create`. Aceptamos el modo aquí para
   * fijar el contrato compartido y evitar refactor breaking en sprints futuros.
   */
  mode: 'create' | 'edit'
  value: TaskMetaState
  onChange: (patch: Partial<TaskMetaState>) => void

  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  phases?: PhaseOption[]
  sprints?: SprintOption[]

  /** Marca el campo Proyecto como required visualmente y para a11y. */
  projectRequired?: boolean

  /** Layout responsive: en `<lg` el padre puede colapsar a 1-col arriba (no afecta esta hoja). */
  className?: string
}

const FIELD_LABEL =
  'text-xs font-semibold uppercase tracking-wider text-muted-foreground'
const SELECT_BASE =
  'w-full rounded-md border border-border bg-input py-1.5 px-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring'
const INPUT_BASE = SELECT_BASE

/**
 * Sidebar de metadatos de tarea (240px en desktop) — reutilizable entre modal
 * de creación y drawer de edición. Sprint 1 sólo usa `mode="create"`.
 *
 * Tokens DS Avante Neutral+: `bg-subtle`, `border-border`, `text-muted-foreground`,
 * asterisco rojo `text-destructive`.
 */
export function TaskMetaSidebar({
  mode,
  value,
  onChange,
  projects,
  users,
  phases = [],
  sprints = [],
  projectRequired = true,
  className,
}: Props) {
  const phasesForProject = useMemo(
    () => phases.filter((p) => p.projectId === value.projectId),
    [phases, value.projectId],
  )
  const sprintsForProject = useMemo(
    () => sprints.filter((s) => s.projectId === value.projectId),
    [sprints, value.projectId],
  )

  const isEdit = mode === 'edit'

  return (
    <aside
      aria-label="Metadatos de la tarea"
      className={clsx(
        'flex flex-col gap-4 bg-subtle p-4',
        'lg:w-60 lg:shrink-0 lg:border-l lg:border-border',
        className,
      )}
    >
      {/* 1. Estado (pills 2x2) */}
      <div className="space-y-1.5">
        <label className={FIELD_LABEL}>Estado</label>
        <StatusPills
          value={value.status}
          onChange={(next) => onChange({ status: next })}
        />
      </div>

      {/* 2. Responsable */}
      <div className="space-y-1.5">
        <label htmlFor="task-meta-assignee" className={FIELD_LABEL}>
          Responsable
        </label>
        <select
          id="task-meta-assignee"
          value={value.assigneeId}
          onChange={(e) => onChange({ assigneeId: e.target.value })}
          className={SELECT_BASE}
        >
          <option value="">Sin asignar</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {/* 3. Proyecto / Épica */}
      <div className="space-y-1.5">
        <label htmlFor="task-meta-project" className={FIELD_LABEL}>
          Proyecto{projectRequired && <span className="text-destructive"> *</span>}
        </label>
        <select
          id="task-meta-project"
          value={value.projectId}
          onChange={(e) => {
            // Cambiar de proyecto invalida épica/sprint del proyecto anterior.
            onChange({ projectId: e.target.value, phaseId: '', sprintId: '' })
          }}
          required={projectRequired}
          aria-required={projectRequired}
          className={SELECT_BASE}
        >
          <option value="">Selecciona…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="task-meta-phase" className={FIELD_LABEL}>
          Épica
        </label>
        <select
          id="task-meta-phase"
          value={value.phaseId}
          onChange={(e) => onChange({ phaseId: e.target.value })}
          disabled={!value.projectId || phasesForProject.length === 0}
          className={clsx(SELECT_BASE, 'disabled:opacity-60')}
        >
          <option value="">
            {!value.projectId
              ? 'Selecciona un proyecto…'
              : phasesForProject.length === 0
                ? 'Sin épicas en este proyecto'
                : 'Sin épica'}
          </option>
          {phasesForProject.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* 4. Sprint / Hito */}
      <div className="space-y-1.5">
        <label htmlFor="task-meta-sprint" className={FIELD_LABEL}>
          Sprint
        </label>
        <select
          id="task-meta-sprint"
          value={value.sprintId}
          onChange={(e) => onChange({ sprintId: e.target.value })}
          disabled={!value.projectId || sprintsForProject.length === 0}
          className={clsx(SELECT_BASE, 'disabled:opacity-60')}
        >
          <option value="">
            {!value.projectId
              ? 'Selecciona un proyecto…'
              : sprintsForProject.length === 0
                ? 'Sin sprints en este proyecto'
                : 'Sin sprint'}
          </option>
          {sprintsForProject.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={value.isMilestone}
          onChange={(e) => onChange({ isMilestone: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-border bg-input accent-primary"
        />
        <span>Es hito</span>
      </label>

      {/* 5. Fecha de inicio */}
      <div className="space-y-1.5">
        <label htmlFor="task-meta-start" className={FIELD_LABEL}>
          Fecha de inicio
        </label>
        <input
          id="task-meta-start"
          type="date"
          value={value.startDate}
          onChange={(e) => onChange({ startDate: e.target.value })}
          className={INPUT_BASE}
        />
      </div>

      {/* 6. Fecha de entrega */}
      <div className="space-y-1.5">
        <label htmlFor="task-meta-end" className={FIELD_LABEL}>
          Fecha de entrega
        </label>
        <input
          id="task-meta-end"
          type="date"
          value={value.endDate}
          onChange={(e) => onChange({ endDate: e.target.value })}
          className={INPUT_BASE}
        />
      </div>

      {/* 7. Estimación (plannedValue en horas) */}
      <div className="space-y-1.5">
        <label htmlFor="task-meta-planned" className={FIELD_LABEL}>
          Estimación
        </label>
        <div className="flex items-center gap-2">
          <input
            id="task-meta-planned"
            type="number"
            min={0}
            step={0.5}
            value={value.plannedValue}
            onChange={(e) => onChange({ plannedValue: e.target.value })}
            placeholder="0"
            className={clsx(INPUT_BASE, 'flex-1')}
          />
          <span className="text-xs text-muted-foreground">horas</span>
        </div>
      </div>

      {isEdit && (
        // Placeholder visual para Sprint 2+; en Sprint 1 mode siempre es 'create'.
        <p className="text-[11px] text-muted-foreground italic">
          (Sprint 2) Edición avanzada — pendiente.
        </p>
      )}
    </aside>
  )
}
