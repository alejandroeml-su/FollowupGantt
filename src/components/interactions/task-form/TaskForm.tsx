'use client'

/**
 * Sprint 5 — `TaskForm` unificado.
 *
 * Componente único que renderiza el formulario de tarea tanto para creación
 * (`mode='create'`, dentro del modal) como para edición (`mode='edit'`,
 * dentro del drawer). Sustituye la lógica duplicada que existía entre
 * `TaskCreationModal` y `TaskDrawerContent`.
 *
 * Diferencias clave entre modos (ver README.md del módulo):
 *  - create: campos esperan "Guardar" global; tabs distintas a Detalle
 *            quedan deshabilitadas hasta que la tarea exista.
 *  - edit:   campos del sidebar y de Detalle persisten inline (onBlur);
 *            todas las tabs son funcionales; mnemónico se muestra como
 *            chip arriba del título.
 *
 * El componente es agnóstico al contenedor visual (modal vs drawer): no
 * monta su propio `<Dialog>`, sólo renderiza el body. El padre se encarga
 * del shell (header con cierre, breadcrumbs, navegación, etc.).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react'
import {
  Briefcase,
  CheckSquare,
  Edit2,
  GitBranch,
  Hash,
  History,
  Link2,
  MessageSquare,
  Paperclip,
  Plus,
  Save,
  Tag,
  X as CloseIcon,
} from 'lucide-react'
import type { TaskStatus } from '@prisma/client'
import { createTask, updateTask } from '@/lib/actions'
import { listProjectTags } from '@/lib/actions/tags'
import { toast } from '../Toaster'
import type { SerializedTask } from '@/lib/types'
import { PriorityPills, type PriorityValue } from './PriorityPills'
import {
  TaskMetaSidebar,
  type PhaseOption,
  type SprintOption,
  type TaskMetaState,
} from './TaskMetaSidebar'
import { TagChipInput } from './TagChipInput'
import { ReferenceUrlField } from './ReferenceUrlField'
import { TaskFormTabs, type TaskFormTab } from './TaskFormTabs'
import { SubtasksTab } from './tabs/SubtasksTab'
import { CommentsTab } from './tabs/CommentsTab'
import { HistoryTab } from './tabs/HistoryTab'
import { AttachmentsTab } from './tabs/AttachmentsTab'
import { DependenciesTab } from './tabs/DependenciesTab'

// ────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────────

export type ParentOption = Pick<SerializedTask, 'id' | 'title' | 'mnemonic'> & {
  project?: { id: string; name: string } | null
  projectId?: string
}

export type TaskFormMode = 'create' | 'edit'

export type TaskFormProps = {
  mode: TaskFormMode
  /** Tarea existente (sólo en mode='edit'). */
  task?: SerializedTask
  /** Catálogos. */
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  phases?: PhaseOption[]
  sprints?: SprintOption[]
  allTasks?: ParentOption[] | SerializedTask[]
  /** Defaults (sólo en mode='create'). */
  defaultParentId?: string
  defaultStatus?: TaskStatus
  /** Callbacks. */
  onCreated?: (taskId: string) => void
  onUpdated?: (taskId: string) => void
  onCancel?: () => void
  /** Render opcional de barra de acciones en el header (drawer-only). */
  renderHeaderActions?: (ctx: HeaderActionsContext) => React.ReactNode
  /** Render opcional del lado izquierdo del header (drawer-only): breadcrumbs. */
  renderHeaderLeft?: (ctx: HeaderActionsContext) => React.ReactNode
  /** Si true, el footer de Cancelar/Guardar global no se renderiza (drawer-only).
   *  El drawer tiene su propio botón Editar/Guardar contextual. */
  hideFooter?: boolean
  /** Layout: contenedor principal del form. Default 'modal' aplica padding y
   *  layout 2-col tipo modal; 'drawer' deja el contenido en 1-col fluido. */
  layout?: 'modal' | 'drawer'
  /** id usado para asociar `<form>` ↔ submit button externo (para drawers).  */
  formId?: string
}

export type HeaderActionsContext = {
  isEditing: boolean
  isPending: boolean
  setEditing: (v: boolean) => void
  saveAll: () => void
}

// Deuda compartida con TaskDrawerContent: sin sesión real, role hardcoded.
const DEBUG_USER_ROLES = ['SUPER_ADMIN']

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

type ActiveTab =
  | 'detail'
  | 'subtasks'
  | 'comments'
  | 'history'
  | 'attachments'
  | 'relations'

// ────────────────────────────────────────────────────────────────────────
// Componente
// ────────────────────────────────────────────────────────────────────────

export function TaskForm({
  mode,
  task,
  projects,
  users,
  phases = [],
  sprints = [],
  allTasks = [],
  defaultParentId,
  defaultStatus,
  onCreated,
  onUpdated,
  onCancel,
  renderHeaderActions,
  renderHeaderLeft,
  hideFooter = false,
  layout = 'modal',
  formId,
}: TaskFormProps) {
  const isCreate = mode === 'create'
  const isEdit = mode === 'edit'
  const [isPending, startTransition] = useTransition()

  // ─── State para CREATE ─────────────────────────────────────────────
  const [isSubtask, setIsSubtask] = useState(isCreate && !!defaultParentId)
  const [form, setForm] = useState(() =>
    isCreate
      ? { ...INITIAL_FORM, parentId: defaultParentId || '' }
      : {
          title: task?.title ?? '',
          description: task?.description ?? '',
          priority: (task?.priority ?? 'MEDIUM') as PriorityValue,
          type: task?.type ?? 'AGILE_STORY',
          parentId: task?.parentId ?? '',
        },
  )
  const [meta, setMeta] = useState<TaskMetaState>(() => {
    if (isEdit && task) {
      return {
        status: (task.status as TaskStatus) ?? 'TODO',
        assigneeId: task.assignee?.id ?? task.assigneeId ?? '',
        projectId: task.projectId ?? task.project?.id ?? '',
        phaseId: '',
        sprintId: '',
        isMilestone: !!task.isMilestone,
        startDate: task.startDate ? task.startDate.split('T')[0] : '',
        endDate: task.endDate ? task.endDate.split('T')[0] : '',
        plannedValue:
          task.plannedValue != null ? String(task.plannedValue) : '',
      }
    }
    return initialMeta(defaultStatus)
  })
  const [tags, setTags] = useState<string[]>(task?.tags ?? [])
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [referenceUrl, setReferenceUrl] = useState(task?.referenceUrl ?? '')
  const [activeTab, setActiveTab] = useState<ActiveTab>('detail')
  // En edit: el botón "Editar" del drawer activa los inputs de detalle.
  const [isEditing, setIsEditing] = useState(false)
  // En edit: progreso/coste sólo afectan al `Guardar` global.
  const [progress, setProgress] = useState(task?.progress ?? 0)
  const [actualCost, setActualCost] = useState(task?.actualCost ?? 0)

  // ─── Sugerencias de tags por proyecto ──────────────────────────────
  useEffect(() => {
    const projectId = meta.projectId
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const list = await listProjectTags(projectId || undefined)
        if (!cancelled) setTagSuggestions(list)
      } catch {
        if (!cancelled) setTagSuggestions([])
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [meta.projectId])

  // ─── Helpers ────────────────────────────────────────────────────────
  const setFormField = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((s) => ({ ...s, [key]: value }))

  const patchMeta = useCallback(
    (patch: Partial<TaskMetaState>) =>
      setMeta((s) => ({ ...s, ...patch })),
    [],
  )

  const handleParentChange = (parentId: string) => {
    const parent = (allTasks as ParentOption[]).find((t) => t.id === parentId)
    setForm((s) => ({ ...s, parentId }))
    const inferredProject = parent?.projectId || parent?.project?.id
    if (inferredProject) {
      patchMeta({ projectId: inferredProject, phaseId: '', sprintId: '' })
    }
  }

  // ─── isDirty (sólo create) ─────────────────────────────────────────
  const isDirty = useMemo(() => {
    if (!isCreate) return false
    return (
      form.title.trim() !== '' ||
      form.description.trim() !== '' ||
      meta.assigneeId !== '' ||
      meta.phaseId !== '' ||
      meta.sprintId !== '' ||
      meta.isMilestone ||
      meta.startDate !== '' ||
      meta.endDate !== '' ||
      meta.plannedValue !== '' ||
      tags.length > 0 ||
      referenceUrl.trim() !== ''
    )
  }, [isCreate, form, meta, tags, referenceUrl])

  // ─── Submits ───────────────────────────────────────────────────────

  const handleCreate = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!form.title.trim()) return toast.error('Título requerido')
    if (!meta.projectId) return toast.error('Proyecto requerido')
    if (isSubtask && !form.parentId)
      return toast.error('Selecciona la tarea padre')

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
        if (meta.phaseId) fd.set('phaseId', meta.phaseId)
        if (meta.sprintId) fd.set('sprintId', meta.sprintId)
        if (meta.isMilestone) fd.set('isMilestone', '1')
        if (meta.plannedValue) fd.set('plannedValue', meta.plannedValue)
        if (tags.length > 0) fd.set('tags', JSON.stringify(tags))
        if (referenceUrl.trim()) fd.set('referenceUrl', referenceUrl.trim())

        await createTask(fd)
        toast.success(isSubtask ? 'Subtarea creada' : 'Tarea creada')
        // createTask es void; el id real se redescubre tras revalidate del server.
        onCreated?.('')
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Error al crear la tarea',
        )
      }
    })
  }

  // Guardado global del modo edit (botón "Guardar" del header del drawer).
  const handleSaveAll = useCallback(() => {
    if (!task) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('id', task.id)
        fd.set('title', form.title)
        fd.set('description', form.description)
        fd.set('status', meta.status)
        fd.set('priority', form.priority)
        fd.set('type', form.type)
        fd.set('assigneeId', meta.assigneeId)
        fd.set('startDate', meta.startDate)
        fd.set('endDate', meta.endDate)
        fd.set('progress', String(progress))
        fd.set('plannedValue', meta.plannedValue || '0')
        fd.set('actualCost', String(actualCost))
        fd.set('userId', users[0]?.id || '')
        fd.set('userRoles', JSON.stringify(DEBUG_USER_ROLES))
        await updateTask(fd)
        setIsEditing(false)
        toast.success('Tarea actualizada correctamente')
        onUpdated?.(task.id)
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : 'Error al actualizar la tarea',
        )
      }
    })
  }, [task, form, meta, progress, actualCost, users, onUpdated])

  // Guardado inline por campo (fechas, plannedValue, actualCost) — comportamiento
  // del drawer antes de Sprint 5; se preserva sin regresión.
  const saveField = (
    field: 'startDate' | 'endDate' | 'plannedValue' | 'actualCost',
    value: string | number,
  ) => {
    if (!task) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('id', task.id)
        fd.set(field, String(value ?? ''))
        fd.set('userId', users[0]?.id || '')
        fd.set('userRoles', JSON.stringify(DEBUG_USER_ROLES))
        await updateTask(fd)
        toast.success('Campo actualizado')
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : 'No se pudo guardar el cambio',
        )
      }
    })
  }

  // ─── Tabs ──────────────────────────────────────────────────────────
  const tabs: TaskFormTab[] = useMemo(() => {
    if (isCreate) {
      const reason = 'Disponible al guardar la tarea'
      return [
        { id: 'detail', label: 'Detalle', icon: Briefcase },
        { id: 'subtasks', label: 'Subtareas', icon: CheckSquare, disabled: true, disabledReason: reason },
        { id: 'comments', label: 'Comentarios', icon: MessageSquare, disabled: true, disabledReason: reason },
        { id: 'history', label: 'Historial', icon: History, disabled: true, disabledReason: reason },
        { id: 'attachments', label: 'Adjuntos', icon: Paperclip, disabled: true, disabledReason: reason },
        { id: 'relations', label: 'Dependencias', icon: GitBranch, disabled: true, disabledReason: reason },
      ]
    }
    return [
      { id: 'detail', label: 'Detalle', icon: Briefcase },
      { id: 'subtasks', label: 'Subtareas', icon: GitBranch, count: task?.subtasks?.length },
      { id: 'comments', label: 'Comentarios', icon: MessageSquare, count: task?.comments?.length },
      { id: 'history', label: 'Historial', icon: History, count: task?.history?.length },
      { id: 'attachments', label: 'Adjuntos', icon: Paperclip, count: task?.attachments?.length },
      { id: 'relations', label: 'Dependencias', icon: GitBranch },
    ]
  }, [isCreate, task])

  // ─── Render ────────────────────────────────────────────────────────

  // Modal layout: 2-col con sidebar 240px (creación).
  // Drawer layout: 1-col fluido sin sidebar separada (la sidebar se renderiza
  // como sección embebida dentro del cuerpo de Detalle).
  const isModalLayout = layout === 'modal'

  const detailBody = (
    <div className={isModalLayout ? 'space-y-4' : 'space-y-6'}>
      {/* En modo edit: chip mnemónico arriba del título. */}
      {isEdit && task && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-black tracking-tighter text-indigo-400 border border-indigo-500/30">
            <Hash className="h-3 w-3" />
            {task.mnemonic || task.id.substring(0, 8).toUpperCase()}
          </span>
          {task.parentId && (
            <span className="inline-flex items-center gap-1 rounded bg-secondary border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <Link2 className="h-3 w-3" />
              Subtarea de #{task.parentId.substring(0, 6)}
            </span>
          )}
        </div>
      )}

      {/* Toggle Tarea/Subtarea — sólo en CREATE. */}
      {isCreate && (
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
      )}

      {/* Tarea padre (CREATE + isSubtask). */}
      {isCreate && isSubtask && (
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
            {(allTasks as ParentOption[]).map((t) => (
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
          Título {isCreate && <span className="text-destructive">*</span>}
        </label>
        {isEdit && !isEditing ? (
          <h2
            id={task ? `drawer-title-${task.id}` : undefined}
            className="text-xl font-bold leading-tight text-foreground"
          >
            {form.title || task?.title}
          </h2>
        ) : (
          <input
            id="task-title"
            autoFocus={isCreate}
            type="text"
            value={form.title}
            onChange={(e) => setFormField('title', e.target.value)}
            placeholder="Ej: Implementar login con Supabase Auth"
            required={isCreate}
            className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
          />
        )}
      </div>

      {/* Descripción */}
      <div className="space-y-1.5">
        <label
          htmlFor="task-description"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Descripción
        </label>
        {isEdit && !isEditing ? (
          <p className="whitespace-pre-wrap text-sm text-foreground/90 rounded-md border border-border bg-subtle/50 p-3">
            {form.description || task?.description || 'Sin descripción.'}
          </p>
        ) : (
          <textarea
            id="task-description"
            value={form.description}
            onChange={(e) => setFormField('description', e.target.value)}
            rows={4}
            placeholder="Contexto, criterios de aceptación…"
            className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        )}
      </div>

      {/* Etiquetas */}
      <div className="space-y-1.5">
        <label
          htmlFor="task-tags"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"
        >
          <Tag className="h-3 w-3" /> Etiquetas
        </label>
        <TagChipInput
          id="task-tags"
          value={tags}
          onChange={setTags}
          suggestions={tagSuggestions}
          readOnly={isEdit && !isEditing}
          aria-describedby="task-tags-hint"
        />
        {isCreate && (
          <p id="task-tags-hint" className="text-[11px] text-muted-foreground">
            Escribe y pulsa Enter. Se canonicalizan a minúsculas y sin
            duplicados.
          </p>
        )}
      </div>

      {/* URL de referencia */}
      <ReferenceUrlField
        mode={mode}
        taskId={task?.id}
        value={referenceUrl}
        onChange={setReferenceUrl}
      />

      {/* Prioridad */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Prioridad
        </label>
        <PriorityPills
          value={form.priority}
          onChange={(next) => setFormField('priority', next)}
        />
      </div>

      {/* Tipo (sólo create — el drawer no exponía edición de Type). */}
      {isCreate && (
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
      )}

      {/* En drawer/edit: bloque "Tiempos e Indicadores" inline (Avance + Estimado/Invertido).
          Persistencia: progress/actualCost por handleSaveAll global; plannedValue inline. */}
      {isEdit && task && (
        <section className="space-y-6 pt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
            Tiempos e Indicadores
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <span className="text-xs text-muted-foreground font-semibold uppercase tracking-widest">
                  Avance Real
                </span>
                <span className="text-sm font-bold text-indigo-400">
                  {progress}%
                </span>
              </div>
              {isEditing ? (
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={progress}
                  onChange={(e) => setProgress(Number(e.target.value))}
                  className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  aria-label="Avance real"
                />
              ) : (
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-subtle/50 p-2 rounded border border-border">
                <span className="block text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  Estimado (Hrs)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={meta.plannedValue}
                  onChange={(e) =>
                    patchMeta({ plannedValue: e.target.value })
                  }
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== (task.plannedValue ?? 0)) saveField('plannedValue', v)
                  }}
                  disabled={isPending}
                  className="w-full bg-input border border-border rounded px-2 py-0.5 text-sm text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                  aria-label="Estimado en horas"
                />
              </div>
              <div className="bg-subtle/50 p-2 rounded border border-border">
                <span className="block text-[10px] text-muted-foreground uppercase font-bold mb-1">
                  Invertido (Hrs)
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={actualCost}
                  onChange={(e) => setActualCost(Number(e.target.value))}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== (task.actualCost ?? 0)) saveField('actualCost', v)
                  }}
                  disabled={isPending}
                  className="w-full bg-input border border-border rounded px-2 py-0.5 text-sm text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                  aria-label="Invertido en horas"
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* En drawer/edit: TaskMetaSidebar embebida como sección, alineada con el comportamiento
          actual donde algunos campos persisten inline. */}
      {isEdit && task && !isModalLayout && (
        <section className="pt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2 mb-3">
            Contexto
          </h3>
          <TaskMetaSidebar
            mode="edit"
            value={meta}
            onChange={patchMeta}
            projects={projects}
            users={users}
            phases={phases}
            sprints={sprints}
            taskId={task.id}
            collaborators={task.collaborators ?? []}
            projectRequired={false}
            className="rounded-lg border border-border lg:w-full lg:border-l-0"
          />
        </section>
      )}
    </div>
  )

  // Forma del cuerpo: en layout 'modal' usamos 2-col (sidebar a la derecha en lg).
  // En layout 'drawer' integramos la sidebar como sección dentro de Detalle.
  const tabContent = (
    <>
      {activeTab === 'detail' && detailBody}
      {activeTab === 'subtasks' && (
        <SubtasksTab
          task={task ?? null}
          users={users}
          initialSubtasks={task?.subtasks}
        />
      )}
      {activeTab === 'comments' && <CommentsTab task={task ?? null} users={users} />}
      {activeTab === 'history' && <HistoryTab task={task ?? null} />}
      {activeTab === 'attachments' && <AttachmentsTab task={task ?? null} />}
      {activeTab === 'relations' && (
        <DependenciesTab task={task ?? null} allTasks={allTasks as SerializedTask[]} />
      )}
    </>
  )

  // Header actions: si el padre las provee (drawer), las renderizamos.
  const headerCtx: HeaderActionsContext = {
    isEditing,
    isPending,
    setEditing: setIsEditing,
    saveAll: handleSaveAll,
  }

  // ─── Modal layout (create) ─────────────────────────────────────────
  if (isModalLayout) {
    return (
      <form
        id={formId}
        onSubmit={handleCreate}
        className="flex flex-1 flex-col overflow-hidden"
        aria-labelledby="task-creation-modal-title"
        data-testid="task-form"
        data-task-form-mode={mode}
      >
        {/* Header (chips de contexto si CREATE) */}
        {isCreate && (
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
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-muted-foreground">
                  Estado: {meta.status}
                </span>
                {projects.find((p) => p.id === meta.projectId)?.name && (
                  <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-muted-foreground">
                    Proyecto: {projects.find((p) => p.id === meta.projectId)?.name}
                  </span>
                )}
                {sprints.find((s) => s.id === meta.sprintId)?.name && (
                  <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-muted-foreground">
                    Sprint: {sprints.find((s) => s.id === meta.sprintId)?.name}
                  </span>
                )}
              </div>
            </div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground"
                aria-label="Cerrar"
                data-dirty={isDirty || undefined}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            )}
          </header>
        )}

        {/* Tabs */}
        <div className="px-6 pt-3 shrink-0">
          <TaskFormTabs
            tabs={tabs}
            active={activeTab}
            onChange={(id) => setActiveTab(id as ActiveTab)}
          />
        </div>

        {/* Body 2-col */}
        <div className="flex flex-1 flex-col-reverse overflow-hidden lg:flex-row">
          <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
            {tabContent}
          </div>
          <div className="overflow-y-auto custom-scrollbar lg:max-h-full">
            <TaskMetaSidebar
              mode={mode}
              value={meta}
              onChange={patchMeta}
              projects={projects}
              users={users}
              phases={phases}
              sprints={sprints}
              projectRequired={isCreate}
              taskId={task?.id}
              collaborators={task?.collaborators ?? []}
            />
          </div>
        </div>

        {/* Footer */}
        {!hideFooter && (
          <footer className="flex justify-end gap-2 border-t border-border px-6 py-4">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
            )}
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md disabled:opacity-60"
            >
              {isPending
                ? isCreate
                  ? 'Creando…'
                  : 'Guardando…'
                : isCreate
                  ? isSubtask
                    ? 'Crear subtarea'
                    : 'Crear tarea'
                  : 'Guardar'}
            </button>
          </footer>
        )}
      </form>
    )
  }

  // ─── Drawer layout (edit) ──────────────────────────────────────────
  // En layout drawer NO renderizamos cabecera propia: el padre (TaskDrawerContent)
  // dispone su propia fila con breadcrumbs + botones Editar/Guardar. Para que el
  // padre pueda invocar las acciones internas del form, exponemos el contexto vía
  // `renderHeaderActions(ctx)`. Si `renderHeaderActions` está presente, se renderiza
  // arriba (caso default cuando alguien usa <TaskForm/> aislado en mode=edit).
  return (
    <article
      aria-labelledby={task ? `drawer-title-${task.id}` : undefined}
      className="flex flex-col h-full overflow-hidden"
      data-testid="task-form"
      data-task-form-mode={mode}
    >
      {(renderHeaderActions || renderHeaderLeft) && (
        <div className="flex items-center justify-between mb-6 shrink-0 px-1">
          <div className="min-w-0 flex-1">
            {renderHeaderLeft?.(headerCtx)}
          </div>
          <div className="flex items-center gap-2">
            {renderHeaderActions?.(headerCtx)}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 shrink-0">
        <TaskFormTabs
          tabs={tabs}
          active={activeTab}
          onChange={(id) => setActiveTab(id as ActiveTab)}
        />
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-8 pb-10 custom-scrollbar">
        {tabContent}
      </div>
    </article>
  )
}

/**
 * Botones por defecto Editar/Guardar/Cancelar para el header del drawer.
 * Se ofrece como helper exportado para que `TaskDrawerContent` pueda
 * componerlos a la derecha de los breadcrumbs sin duplicar JSX.
 */
export function TaskFormHeaderActions({
  ctx,
  hidden = false,
}: {
  ctx: HeaderActionsContext
  hidden?: boolean
}) {
  if (hidden) return null
  return ctx.isEditing ? (
    <>
      <button
        type="button"
        onClick={() => ctx.setEditing(false)}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
      >
        <CloseIcon className="h-3.5 w-3.5" /> Cancelar
      </button>
      <button
        type="button"
        onClick={ctx.saveAll}
        disabled={ctx.isPending}
        className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
      >
        <Save className="h-3.5 w-3.5" /> Guardar
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={() => ctx.setEditing(true)}
      className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground/90 hover:bg-secondary/80 transition-colors"
    >
      <Edit2 className="h-3.5 w-3.5" /> Editar
    </button>
  )
}
