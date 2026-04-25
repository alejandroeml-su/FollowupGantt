'use client'

import { useState, useTransition } from 'react'
import {
  Calendar,
  UserCircle2,
  Tag,
  Hash,
  Link2,
  Activity,
  Briefcase,
  Edit2,
  Save,
  X as CloseIcon,
  MessageSquare,
  History,
  Paperclip,
  GitBranch,
} from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import StatusSelector from '@/components/StatusSelector'
import { TaskBreadcrumbs } from './TaskDrawer'
import { updateTask } from '@/lib/actions'
import { toast } from './Toaster'
import { TaskFormTabs, type TaskFormTab } from './task-form/TaskFormTabs'
import { CommentsTab } from './task-form/tabs/CommentsTab'
import { HistoryTab } from './task-form/tabs/HistoryTab'
import { AttachmentsTab } from './task-form/tabs/AttachmentsTab'
import { DependenciesTab } from './task-form/tabs/DependenciesTab'
import { SubtasksTab } from './task-form/tabs/SubtasksTab'

type Props = {
  task: SerializedTask
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks?: SerializedTask[]
}

type Tab = 'detail' | 'subtasks' | 'comments' | 'history' | 'attachments' | 'relations'

// Deuda: sin sesión real aún, se usa SUPER_ADMIN hardcoded (mismo patrón
// que CalendarBoardClient / Sidebar.debugRole). Reemplazar cuando exista auth.
const DEBUG_USER_ROLES = ['SUPER_ADMIN']

export function TaskDrawerContent({ task, users, allTasks = [] }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('detail')
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Form State (Detail)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [status, setStatus] = useState(task.status)
  const [priority, setPriority] = useState(task.priority)
  // `type` actualmente no es editable desde el drawer; se persiste tal cual.
  // No se gestiona estado para evitar warning de variable sin uso.
  const type = task.type
  const [assigneeId, setAssigneeId] = useState(task.assignee?.id || '')
  const [startDate, setStartDate] = useState(task.startDate ? task.startDate.split('T')[0] : '')
  const [endDate, setEndDate] = useState(task.endDate ? task.endDate.split('T')[0] : '')
  const [progress, setProgress] = useState(task.progress)
  const [plannedValue, setPlannedValue] = useState(task.plannedValue || 0)
  const [actualCost, setActualCost] = useState(task.actualCost || 0)

  const handleSave = () => {
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('id', task.id)
        fd.set('title', title)
        fd.set('description', description)
        fd.set('status', status)
        fd.set('priority', priority)
        fd.set('type', type)
        fd.set('assigneeId', assigneeId)
        fd.set('startDate', startDate)
        fd.set('endDate', endDate)
        fd.set('progress', String(progress))
        fd.set('plannedValue', String(plannedValue))
        fd.set('actualCost', String(actualCost))
        fd.set('userId', users[0]?.id || '')
        fd.set('userRoles', JSON.stringify(DEBUG_USER_ROLES))

        await updateTask(fd)
        setIsEditing(false)
        toast.success('Tarea actualizada correctamente')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al actualizar la tarea')
      }
    })
  }

  // Guardado inline (sin pulsar "Editar") para campos cuantitativos:
  // fechas, estimado y costo real — tanto para tareas padre como subtareas.
  const saveField = (field: 'startDate' | 'endDate' | 'plannedValue' | 'actualCost', value: string | number) => {
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
        toast.error(err instanceof Error ? err.message : 'No se pudo guardar el cambio')
      }
    })
  }

  const progressColor = progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'

  // Cálculos de alcance
  const difference = plannedValue - actualCost
  const diffColor = difference >= 0 ? 'text-emerald-400' : 'text-rose-400'

  const tabs: TaskFormTab[] = [
    { id: 'detail', label: 'Detalle', icon: Briefcase },
    { id: 'subtasks', label: 'Subtareas', icon: GitBranch, count: task.subtasks?.length },
    { id: 'comments', label: 'Comentarios', icon: MessageSquare, count: task.comments?.length },
    { id: 'history', label: 'Historial', icon: History, count: task.history?.length },
    { id: 'attachments', label: 'Adjuntos', icon: Paperclip, count: task.attachments?.length },
    { id: 'relations', label: 'Dependencias', icon: GitBranch },
  ]

  return (
    <article aria-labelledby={`drawer-title-${task.id}`} className="flex flex-col h-full overflow-hidden">

      {/* Header Actions */}
      <div className="flex items-center justify-between mb-6 shrink-0 px-1">
        <TaskBreadcrumbs
          segments={[
            ...(task.project ? [{ label: task.project.name }] : []),
            { label: `Tarea #${task.mnemonic || task.id.substring(0, 6)}` },
          ]}
        />
        <div className="flex items-center gap-2">
          {activeTab === 'detail' && (
            isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
                >
                  <CloseIcon className="h-3.5 w-3.5" /> Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" /> Guardar
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground/90 hover:bg-secondary/80 transition-colors"
              >
                <Edit2 className="h-3.5 w-3.5" /> Editar
              </button>
            )
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 shrink-0">
        <TaskFormTabs
          tabs={tabs}
          active={activeTab}
          onChange={(id) => setActiveTab(id as Tab)}
        />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-8 pb-10 custom-scrollbar">

        {activeTab === 'detail' && (
          <>
            {/* 1. Identificación y Jerarquía */}
            <section className="space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center gap-1 rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-black tracking-tighter text-indigo-400 border border-indigo-500/30">
                    <Hash className="h-3 w-3" />
                    {task.mnemonic || task.id.substring(0, 8).toUpperCase()}
                  </span>
                  {task.parentId && (
                    <span className="inline-flex items-center gap-1 rounded bg-secondary border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground cursor-pointer hover:bg-secondary/80 transition-colors">
                      <Link2 className="h-3 w-3" />
                      Subtarea de #{task.parentId.substring(0, 6)}
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-input border border-border rounded-md px-3 py-2 text-xl font-bold text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                ) : (
                  <h2 className="text-xl font-bold leading-tight text-white">{task.title}</h2>
                )}
              </div>

              <div className="rounded-lg border border-border bg-subtle/50 p-3 mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descripción</h3>
                {isEditing ? (
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-foreground/90">{task.description || 'Sin descripción.'}</p>
                )}
              </div>

              {/* Tags read-only en el drawer (Sprint 2 sólo agrega edición de tags
                  desde el modal de creación; el formulario de edición se aborda
                  en sprints posteriores). */}
              {task.tags && task.tags.length > 0 && (
                <div className="rounded-lg border border-border bg-subtle/50 p-3 mt-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <Tag className="h-3 w-3" /> Etiquetas
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {task.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-xs text-blue-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Contexto y Responsabilidades */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-8">
               <div className="space-y-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
                    <Briefcase className="h-4 w-4" /> Contexto
                  </h3>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground mb-1 text-xs uppercase tracking-wider font-semibold">Estado</dt>
                      <dd>{isEditing ? (
                        <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-input border border-border rounded px-2 py-1.5 text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                          <option value="TODO">To Do</option>
                          <option value="IN_PROGRESS">In Progress</option>
                          <option value="REVIEW">Review</option>
                          <option value="DONE">Done</option>
                        </select>
                      ) : <StatusSelector taskId={task.id} currentStatus={task.status} />}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground mb-1 text-xs uppercase tracking-wider font-semibold">Prioridad</dt>
                      <dd>{isEditing ? (
                        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full bg-input border border-border rounded px-2 py-1.5 text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                          <option value="LOW">Baja</option>
                          <option value="MEDIUM">Media</option>
                          <option value="HIGH">Alta</option>
                          <option value="CRITICAL">Crítica</option>
                        </select>
                      ) : <span className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase border ${
                        task.priority === 'CRITICAL' ? 'bg-red-500/15 text-red-300 border-red-500/40' :
                        task.priority === 'HIGH' ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' :
                        task.priority === 'MEDIUM' ? 'bg-blue-500/15 text-blue-300 border-blue-500/40' :
                        'bg-secondary text-muted-foreground border-border'
                      }`}>{task.priority}</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground mb-1 text-xs uppercase tracking-wider font-semibold flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-indigo-400" /> Fechas (Cronograma)
                      </dt>
                      <dd>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Inicio</label>
                            <input
                              type="date"
                              value={startDate}
                              onChange={(e) => setStartDate(e.target.value)}
                              onBlur={(e) => {
                                if (e.target.value !== (task.startDate ? task.startDate.split('T')[0] : '')) {
                                  saveField('startDate', e.target.value)
                                }
                              }}
                              disabled={isPending}
                              className="bg-input border border-border rounded px-2 py-1 text-xs text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Fin</label>
                            <input
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                              onBlur={(e) => {
                                if (e.target.value !== (task.endDate ? task.endDate.split('T')[0] : '')) {
                                  saveField('endDate', e.target.value)
                                }
                              }}
                              disabled={isPending}
                              className="bg-input border border-border rounded px-2 py-1 text-xs text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                            />
                          </div>
                        </div>
                      </dd>
                    </div>
                  </dl>
               </div>
               <div className="space-y-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
                    <UserCircle2 className="h-4 w-4" /> Responsabilidades
                  </h3>
                  <dl className="space-y-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground mb-1 text-xs uppercase tracking-wider font-semibold">Asignado</dt>
                      <dd>{isEditing ? (
                        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full bg-input border border-border rounded px-2 py-1.5 text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                          <option value="">Sin asignar</option>
                          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white uppercase">
                            {task.assignee?.name?.charAt(0) || '?'}
                          </div>
                          <span className="font-medium text-foreground">{task.assignee?.name || 'Sin asignar'}</span>
                        </div>
                      )}</dd>
                    </div>
                  </dl>
               </div>
            </section>

            {/* Tiempos e Indicadores */}
            <section className="space-y-6 pt-4">
               <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">
                 <Activity className="h-4 w-4" /> Tiempos e Indicadores
               </h3>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-4">
                     <div className="flex justify-between items-end">
                        <span className="text-xs text-muted-foreground font-semibold uppercase tracking-widest">Avance Real</span>
                        <span className="text-sm font-bold text-indigo-400">{progress}%</span>
                     </div>
                     {isEditing ? (
                        <input type="range" min="0" max="100" value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                     ) : (
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                           <div className={`h-full transition-all duration-500 ${progressColor}`} style={{ width: `${progress}%` }} />
                        </div>
                     )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                      <div className="bg-subtle/50 p-2 rounded border border-border">
                        <span className="block text-[10px] text-muted-foreground uppercase font-bold mb-1">Estimado (Hrs)</span>
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          value={plannedValue}
                          onChange={(e) => setPlannedValue(Number(e.target.value))}
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (v !== (task.plannedValue ?? 0)) saveField('plannedValue', v)
                          }}
                          disabled={isPending}
                          className="w-full bg-input border border-border rounded px-2 py-0.5 text-sm text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                        />
                      </div>
                      <div className="bg-subtle/50 p-2 rounded border border-border relative">
                        <span className="block text-[10px] text-muted-foreground uppercase font-bold mb-1">Invertido (Hrs)</span>
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
                        />
                        <span className={`absolute top-2 right-2 text-[9px] font-bold ${diffColor}`}>
                          {difference >= 0 ? '+' : ''}{difference}h
                        </span>
                      </div>
                  </div>
               </div>
            </section>
          </>
        )}

        {activeTab === 'subtasks' && (
          <SubtasksTab
            task={task}
            users={users}
            initialSubtasks={task.subtasks}
          />
        )}
        {activeTab === 'comments' && <CommentsTab task={task} users={users} />}
        {activeTab === 'history' && <HistoryTab task={task} />}
        {activeTab === 'attachments' && <AttachmentsTab task={task} />}
        {activeTab === 'relations' && <DependenciesTab task={task} allTasks={allTasks} />}

      </div>
    </article>
  )
}
