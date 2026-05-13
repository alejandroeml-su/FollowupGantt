'use client'

import { useMemo } from 'react'
import { clsx } from 'clsx'
import type { TaskStatus } from '@prisma/client'
import { StatusPills } from './StatusPills'
import { CollaboratorsField, type CollaboratorOption } from './CollaboratorsField'

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
  /** Wave P9 · Agile Maturity (HU-9.2) — Epic asignada a la task.
   * `''` = sin epic. La sub-tarea hereda del padre por defecto en createTask. */
  epicId: string
  isMilestone: boolean
  startDate: string
  endDate: string
  /** Estimación en horas (campo `plannedValue` del schema). */
  plannedValue: string
}

/** Wave P9 — opción de Epic para selector. */
export type EpicOption = {
  id: string
  name: string
  color: string
  projectId: string
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
  /** Wave P9 — Epics del proyecto seleccionado, para el selector. */
  epics?: EpicOption[]

  /** Marca el campo Proyecto como required visualmente y para a11y. */
  projectRequired?: boolean

  /** Layout responsive: en `<lg` el padre puede colapsar a 1-col arriba (no afecta esta hoja). */
  className?: string

  /** Sprint 4 — sólo en modo `edit`. ID de la tarea para mutar colaboradores. */
  taskId?: string
  /** Sprint 4 — colaboradores actuales serializados desde el server. */
  collaborators?: CollaboratorOption[]

  /** Fase 1 (2026-05-13) — Tipo de tarea para renderizado condicional:
   *    AGILE_STORY → Sprint + Epic visibles
   *    PMI_TASK    → Hito + Estimación + Fechas visibles
   *    ITIL_TICKET → solo Estado/Responsable/Proyecto/Categoría (sin
   *                   Sprint/Epic/Hito/Estimación; los SLA dates y
   *                   detalles ITIL viven en TaskItilSection) */
  taskType?: 'AGILE_STORY' | 'PMI_TASK' | 'ITIL_TICKET' | string
}

const FIELD_LABEL =
  'text-xs font-semibold uppercase tracking-wider text-foreground'
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
  epics = [],
  projectRequired = true,
  className,
  taskId,
  collaborators = [],
  taskType,
}: Props) {
  // Fase 1 — renderizado condicional según metodología. Default a AGILE
  // si no se pasa (back-compat con callers existentes que no especifican).
  const isAgile = taskType === 'AGILE_STORY' || !taskType
  const isPMI = taskType === 'PMI_TASK'
  const isITIL = taskType === 'ITIL_TICKET'
  const phasesForProject = useMemo(
    () => phases.filter((p) => p.projectId === value.projectId),
    [phases, value.projectId],
  )
  const sprintsForProject = useMemo(
    () => sprints.filter((s) => s.projectId === value.projectId),
    [sprints, value.projectId],
  )
  // Wave P9 · Agile Maturity — Epics filtradas por proyecto + lookup actual.
  const epicsForProject = useMemo(
    () => epics.filter((e) => e.projectId === value.projectId),
    [epics, value.projectId],
  )
  const selectedEpic = useMemo(
    () => (value.epicId ? epicsForProject.find((e) => e.id === value.epicId) : null) ?? null,
    [epicsForProject, value.epicId],
  )

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

      {/* 2.b Colaboradores (Sprint 4) — funcional sólo en modo edit */}
      <CollaboratorsField
        mode={mode}
        taskId={taskId}
        assigneeId={value.assigneeId || null}
        collaborators={collaborators}
        users={users}
      />

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
            onChange({ projectId: e.target.value, phaseId: '', sprintId: '', epicId: '' })
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
        {/* Bug Edwin 2026-05-13: este campo enlaza al `phaseId` (Fase del
            proyecto, modelo `Phase`) — la label decía "Épica" lo que daba
            la apariencia de un segundo selector de Epic, confundido con el
            selector real (`epicId`) más abajo. La label correcta es "Fase". */}
        <label htmlFor="task-meta-phase" className={FIELD_LABEL}>
          Fase
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
                ? 'Sin fases en este proyecto'
                : 'Sin fase'}
          </option>
          {phasesForProject.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* 4. Sprint — solo para AGILE_STORY (Fase 1, 2026-05-13). */}
      {isAgile && (
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
      )}

      {/* Wave P9 · Agile Maturity (HU-9.2) — Selector de Epic.
          Solo para AGILE_STORY (Fase 1, 2026-05-13). */}
      {isAgile && (
      <div className="space-y-1.5">
        <label htmlFor="task-meta-epic" className={FIELD_LABEL}>
          Epic
        </label>
        <select
          id="task-meta-epic"
          value={value.epicId}
          onChange={(e) => onChange({ epicId: e.target.value })}
          disabled={!value.projectId || epicsForProject.length === 0}
          className={clsx(SELECT_BASE, 'disabled:opacity-60')}
        >
          <option value="">
            {!value.projectId
              ? 'Selecciona un proyecto…'
              : epicsForProject.length === 0
                ? 'Sin Epics en este proyecto'
                : 'Sin Epic asignada'}
          </option>
          {epicsForProject.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {selectedEpic && (
          <div
            className="mt-1 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px]"
            style={{
              backgroundColor: `${selectedEpic.color}33`,
              color: selectedEpic.color,
              border: `1px solid ${selectedEpic.color}66`,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: selectedEpic.color }}
              aria-hidden
            />
            <span className="font-semibold">{selectedEpic.name}</span>
          </div>
        )}
      </div>
      )}

      {/* Hito — solo PMI (Fase 1, 2026-05-13). */}
      {isPMI && (
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={value.isMilestone}
          onChange={(e) => onChange({ isMilestone: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-border bg-input accent-primary"
        />
        <span>Es hito</span>
      </label>
      )}

      {/* 5. Fecha de inicio. ITIL reusa estos campos como "Tiempo de
          respuesta SLA" semánticamente, pero por ahora mostramos el mismo
          input con label diferente. (Deuda Fase 2: separar SLA targets.) */}
      <div className="space-y-1.5">
        <label htmlFor="task-meta-start" className={FIELD_LABEL}>
          {isITIL ? 'Inicio / Detección' : 'Fecha de inicio'}
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
          {isITIL ? 'Objetivo de resolución' : 'Fecha de entrega'}
        </label>
        <input
          id="task-meta-end"
          type="date"
          value={value.endDate}
          onChange={(e) => onChange({ endDate: e.target.value })}
          className={INPUT_BASE}
        />
      </div>

      {/* 7. Estimación (plannedValue en horas) — solo PMI/AGILE, no aplica
          a ITIL (allí el "esfuerzo" se mide con SLA targets, no estimación). */}
      {!isITIL && (
      <div className="space-y-1.5">
        <label htmlFor="task-meta-planned" className={FIELD_LABEL}>
          {isAgile ? 'Estimación (horas ideales)' : 'Estimación'}
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
      )}

      {/* Sprint 4: el sidebar ya soporta `mode='edit'` con sección Colaboradores
          funcional (ver CollaboratorsField). El resto de campos comparten contrato
          con `mode='create'` y se persisten desde el padre (Drawer/Modal). */}
    </aside>
  )
}
