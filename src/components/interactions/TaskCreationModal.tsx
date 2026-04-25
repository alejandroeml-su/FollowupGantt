'use client'

import { useState, useTransition, useEffect } from 'react'
import { X, Plus, GitBranch } from 'lucide-react'
import { createTask } from '@/lib/actions'
import { toast } from './Toaster'
import type { SerializedTask } from '@/lib/types'

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
}

const INITIAL_STATE = {
  title: '',
  projectId: '',
  parentId: '',
  priority: 'MEDIUM',
  type: 'AGILE_STORY',
  assigneeId: '',
  startDate: '',
  endDate: '',
  description: '',
}

export function TaskCreationModal({
  open,
  onClose,
  projects,
  users,
  allTasks = [],
  defaultParentId,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [isSubtask, setIsSubtask] = useState(!!defaultParentId)
  const [form, setForm] = useState(INITIAL_STATE)

  /* eslint-disable react-hooks/set-state-in-effect */
  // Reset por transición open=false→true (evento, no derivación de props).
  useEffect(() => {
    if (open) {
      setIsSubtask(!!defaultParentId)
      setForm({
        ...INITIAL_STATE,
        parentId: defaultParentId || '',
        projectId: defaultParentId
          ? (allTasks.find(t => t.id === defaultParentId)?.projectId
              || allTasks.find(t => t.id === defaultParentId)?.project?.id
              || '')
          : '',
      })
    }
  }, [open, defaultParentId, allTasks])
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm(s => ({ ...s, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return toast.error('Título requerido')
    if (!form.projectId) return toast.error('Proyecto requerido')
    if (isSubtask && !form.parentId) return toast.error('Selecciona la tarea padre')

    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('title', form.title.trim())
        fd.set('projectId', form.projectId)
        fd.set('priority', form.priority)
        fd.set('type', form.type)
        if (form.assigneeId) fd.set('assigneeId', form.assigneeId)
        if (form.startDate) fd.set('startDate', form.startDate)
        if (form.endDate) fd.set('endDate', form.endDate)
        if (form.description) fd.set('description', form.description)
        if (isSubtask && form.parentId) fd.set('parentId', form.parentId)

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
    const parent = allTasks.find(t => t.id === parentId)
    setForm(s => ({
      ...s,
      parentId,
      projectId: parent?.projectId || parent?.project?.id || s.projectId,
    }))
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card border border-border rounded-xl shadow-2xl p-6 space-y-4 custom-scrollbar"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            {isSubtask ? <GitBranch className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
            {isSubtask ? 'Nueva subtarea' : 'Nueva tarea'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toggle Tarea / Subtarea */}
        <div className="flex items-center gap-2 p-1 bg-muted rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setIsSubtask(false)}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              !isSubtask ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Tarea
          </button>
          <button
            type="button"
            onClick={() => setIsSubtask(true)}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              isSubtask ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Subtarea
          </button>
        </div>

        {/* Tarea padre (solo si es subtarea) */}
        {isSubtask && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tarea padre *
            </label>
            <select
              value={form.parentId}
              onChange={(e) => handleParentChange(e.target.value)}
              required={isSubtask}
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">Selecciona la tarea padre…</option>
              {allTasks.map(t => (
                <option key={t.id} value={t.id}>
                  {t.mnemonic ? `[${t.mnemonic}] ` : ''}{t.title}
                  {t.project?.name ? ` — ${t.project.name}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Puedes elegir cualquier tarea de cualquier proyecto existente.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Título */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Título *</label>
            <input
              autoFocus
              type="text"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Ej: Implementar login con Supabase Auth"
              required
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* Proyecto */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proyecto *</label>
            <select
              value={form.projectId}
              onChange={(e) => set('projectId', e.target.value)}
              required
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">Selecciona…</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Prioridad */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prioridad</label>
            <select
              value={form.priority}
              onChange={(e) => set('priority', e.target.value)}
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
              <option value="CRITICAL">Crítica</option>
            </select>
          </div>

          {/* Tipo */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tipo</label>
            <select
              value={form.type}
              onChange={(e) => set('type', e.target.value)}
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="AGILE_STORY">Agile Story</option>
              <option value="PMI_TASK">PMI Task</option>
              <option value="ITIL_TICKET">ITIL Ticket</option>
            </select>
          </div>

          {/* Asignado */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Asignado</label>
            <select
              value={form.assigneeId}
              onChange={(e) => set('assigneeId', e.target.value)}
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">Sin asignar</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Fechas */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha inicio</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fecha fin</label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* Descripción */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Descripción</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder="Contexto, criterios de aceptación…"
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-60"
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
        </div>
      </form>
    </div>
  )
}
