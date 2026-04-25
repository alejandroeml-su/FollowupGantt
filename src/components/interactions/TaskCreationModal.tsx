'use client'

import { useState, useTransition, useEffect, useMemo, useCallback } from 'react'
import { X, Plus, GitBranch } from 'lucide-react'
import type { TaskStatus } from '@prisma/client'
import { createTask } from '@/lib/actions'
import { toast } from './Toaster'
import type { SerializedTask } from '@/lib/types'
import { PriorityPills, type PriorityValue } from './task-form/PriorityPills'
import {
  TaskMetaSidebar,
  type PhaseOption,
  type SprintOption,
  type TaskMetaState,
} from './task-form/TaskMetaSidebar'

type ParentOption = Pick<SerializedTask, 'id' | 'title' | 'mnemonic'> & {
  project?: { id: string; name: string } | null
  projectId?: string
}

type Props = {
  open: boolean
  onClose: () => void
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks?: ParentOption[]
  /** Si se pasa, abre el modal en modo subtarea con este padre pre-seleccionado. */
  defaultParentId?: string
  /**
   * Estado inicial para la nueva tarea (ej. al crear desde una columna del Kanban).
   * Si no se pasa, la server action `createTask` aplica 'TODO' por defecto.
   */
  defaultStatus?: TaskStatus
  /** Épicas (Phase del schema) por proyecto. Compat: opcional, default []. */
  phases?: PhaseOption[]
  /** Sprints por proyecto. Compat: opcional, default []. */
  sprints?: SprintOption[]
}

const INITIAL_FORM = {
  title: '',
  description: '',
  priority: 'MEDIUM' as PriorityValue,
  type: 'AGILE_STORY',
  parentId: '',
}

const initialMeta = (defaultStatus?: TaskStatus): TaskMetaState => ({
  status: defaultStatus ?? 'TODO',
  assigneeId: '',
  projectId: '',
  phaseId: '',
  sprintId: '',
  isMilestone: false,
  startDate: '',
  endDate: '',
  plannedValue: '',
})

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
  const [isPending, startTransition] = useTransition()
  const [isSubtask, setIsSubtask] = useState(!!defaultParentId)
  const [form, setForm] = useState(INITIAL_FORM)
  const [meta, setMeta] = useState<TaskMetaState>(() => initialMeta(defaultStatus))

  /* eslint-disable react-hooks/set-state-in-effect */
  // Reset por transición open=false→true (evento, no derivación de props).
  useEffect(() => {
    if (open) {
      setIsSubtask(!!defaultParentId)
      const parent = defaultParentId
        ? allTasks.find((t) => t.id === defaultParentId)
        : undefined
      const initialProjectId =
        parent?.projectId || parent?.project?.id || ''
      setForm({
        ...INITIAL_FORM,
        parentId: defaultParentId || '',
      })
      setMeta({
        ...initialMeta(defaultStatus),
        projectId: initialProjectId,
      })
    }
  }, [open, defaultParentId, defaultStatus, allTasks])
  /* eslint-enable react-hooks/set-state-in-effect */

  const isDirty = useMemo(() => {
    return (
      form.title.trim() !== '' ||
      form.description.trim() !== '' ||
      meta.assigneeId !== '' ||
      meta.phaseId !== '' ||
      meta.sprintId !== '' ||
      meta.isMilestone ||
      meta.startDate !== '' ||
      meta.endDate !== '' ||
      meta.plannedValue !== ''
    )
  }, [form, meta])

  const handleClose = useCallback(() => {
    if (isPending) return
    if (isDirty) {
      const ok = window.confirm(
        'Tienes cambios sin guardar. ¿Cerrar y descartar?',
      )
      if (!ok) return
    }
    onClose()
  }, [isDirty, isPending, onClose])

  // Esc para cerrar.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  const setFormField = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((s) => ({ ...s, [key]: value }))

  const patchMeta = (patch: Partial<TaskMetaState>) =>
    setMeta((s) => ({ ...s, ...patch }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('Título requerido')
    if (!meta.projectId) return toast.error('Proyecto requerido')
    if (isSubtask && !form.parentId) return toast.error('Selecciona la tarea padre')

    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('title', form.title.trim())
        fd.set('projectId', meta.projectId)
        fd.set('priority', form.priority)
        fd.set('type', form.type)
        fd.set('status', meta.status)
        if (meta.assigneeId) fd.set('assigneeId', meta.assigneeId)
        if (meta.startDate) fd.set('startDate', meta.startDate)
        if (meta.endDate) fd.set('endDate', meta.endDate)
        if (form.description) fd.set('description', form.description)
        if (isSubtask && form.parentId) fd.set('parentId', form.parentId)
        // Sprint 1: estos campos viajan en el FormData para que el backend pueda
        // adoptarlos sin breaking change. La server action `createTask` actual
        // los ignora silenciosamente — se persistirán cuando @Dev extienda
        // `createTask` en un sprint posterior (no incluido aquí por instrucción
        // explícita del brief: "NO modificar el server action").
        if (meta.phaseId) fd.set('phaseId', meta.phaseId)
        if (meta.sprintId) fd.set('sprintId', meta.sprintId)
        if (meta.isMilestone) fd.set('isMilestone', '1')
        if (meta.plannedValue) fd.set('plannedValue', meta.plannedValue)

        await createTask(fd)
        toast.success(isSubtask ? 'Subtarea creada' : 'Tarea creada')
        onClose()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al crear la tarea')
      }
    })
  }

  // Cuando el usuario cambia de tarea padre, auto-selecciona su proyecto.
  const handleParentChange = (parentId: string) => {
    const parent = allTasks.find((t) => t.id === parentId)
    setForm((s) => ({ ...s, parentId }))
    const inferredProject = parent?.projectId || parent?.project?.id
    if (inferredProject) {
      patchMeta({ projectId: inferredProject, phaseId: '', sprintId: '' })
    }
  }

  if (!open) return null

  const projectName = projects.find((p) => p.id === meta.projectId)?.name
  const sprintName = sprints.find((s) => s.id === meta.sprintId)?.name

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleClose}
      role="presentation"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-creation-modal-title"
        className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-card border border-border rounded-xl shadow-2xl flex flex-col"
      >
        {/* Header */}
        <header className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="flex flex-1 flex-col gap-2">
            <h2
              id="task-creation-modal-title"
              className="text-lg font-bold text-foreground flex items-center gap-2"
            >
              {isSubtask ? (
                <GitBranch className="h-5 w-5 text-primary" />
              ) : (
                <Plus className="h-5 w-5 text-primary" />
              )}
              {isSubtask ? 'Nueva subtarea' : 'Nueva tarea'}
            </h2>
            {/* Meta-chips de contexto */}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-muted-foreground">
                Estado: {meta.status}
              </span>
              {projectName && (
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-muted-foreground">
                  Proyecto: {projectName}
                </span>
              )}
              {sprintName && (
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-muted-foreground">
                  Sprint: {sprintName}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body 2-col (≥lg). En <lg: 1-col, sidebar arriba como bloque. */}
        <div className="flex flex-1 flex-col-reverse overflow-hidden lg:flex-row">
          {/* Columna izquierda: contenido principal */}
          <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
            <div className="space-y-4">
              {/* Toggle Tarea / Subtarea */}
              <div className="flex items-center gap-2 p-1 bg-muted rounded-lg w-fit">
                <button
                  type="button"
                  onClick={() => setIsSubtask(false)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    !isSubtask
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Tarea
                </button>
                <button
                  type="button"
                  onClick={() => setIsSubtask(true)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                    isSubtask
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Subtarea
                </button>
              </div>

              {/* Tarea padre (solo si es subtarea) */}
              {isSubtask && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="task-parent"
                    className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Tarea padre <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="task-parent"
                    value={form.parentId}
                    onChange={(e) => handleParentChange(e.target.value)}
                    required={isSubtask}
                    className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Selecciona la tarea padre…</option>
                    {allTasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.mnemonic ? `[${t.mnemonic}] ` : ''}
                        {t.title}
                        {t.project?.name ? ` — ${t.project.name}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Puedes elegir cualquier tarea de cualquier proyecto existente.
                  </p>
                </div>
              )}

              {/* Título */}
              <div className="space-y-1.5">
                <label
                  htmlFor="task-title"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Título <span className="text-destructive">*</span>
                </label>
                <input
                  id="task-title"
                  autoFocus
                  type="text"
                  value={form.title}
                  onChange={(e) => setFormField('title', e.target.value)}
                  placeholder="Ej: Implementar login con Supabase Auth"
                  required
                  className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {/* Descripción */}
              <div className="space-y-1.5">
                <label
                  htmlFor="task-description"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Descripción
                </label>
                <textarea
                  id="task-description"
                  value={form.description}
                  onChange={(e) => setFormField('description', e.target.value)}
                  rows={4}
                  placeholder="Contexto, criterios de aceptación…"
                  className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>

              {/* Prioridad (pills horizontales) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Prioridad
                </label>
                <PriorityPills
                  value={form.priority}
                  onChange={(next) => setFormField('priority', next)}
                />
              </div>

              {/* Tipo (sigue siendo select por decisión del brief) */}
              <div className="space-y-1.5">
                <label
                  htmlFor="task-type"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Tipo
                </label>
                <select
                  id="task-type"
                  value={form.type}
                  onChange={(e) => setFormField('type', e.target.value)}
                  className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="AGILE_STORY">Agile Story</option>
                  <option value="PMI_TASK">PMI Task</option>
                  <option value="ITIL_TICKET">ITIL Ticket</option>
                </select>
              </div>
            </div>
          </div>

          {/* Sidebar derecha (en lg+; en <lg aparece arriba por flex-col-reverse) */}
          <div className="overflow-y-auto custom-scrollbar lg:max-h-full">
            <TaskMetaSidebar
              mode="create"
              value={meta}
              onChange={patchMeta}
              projects={projects}
              users={users}
              phases={phases}
              sprints={sprints}
              projectRequired
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md disabled:opacity-60"
          >
            {isPending ? 'Creando…' : isSubtask ? 'Crear subtarea' : 'Crear tarea'}
          </button>
        </footer>
      </form>
    </div>
  )
}
