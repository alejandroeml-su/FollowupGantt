'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Calendar,
  Flag,
  UserCircle2,
  Clock,
  Tag,
  Hash,
  Link2,
  Activity,
  CheckSquare,
  AlertCircle,
  Briefcase,
  ChevronRight,
  Edit2,
  Save,
  X as CloseIcon,
  MessageSquare,
  History,
  Paperclip,
  Send,
  FileIcon,
  ShieldCheck,
  Globe,
  GitBranch,
  Trash2,
  Plus
} from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import StatusSelector from '@/components/StatusSelector'
import { TaskBreadcrumbs } from './TaskDrawer'
import { updateTask, createComment, createAttachment, addDependency, removeDependency } from '@/lib/actions'
import { toast } from './Toaster'

type Props = {
  task: SerializedTask
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks?: SerializedTask[]
}

type Tab = 'detail' | 'tracking' | 'history' | 'attachments' | 'relations'

type DepType = 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH' | 'START_TO_FINISH'

const DEP_TYPES: { value: DepType; short: string; label: string }[] = [
  { value: 'FINISH_TO_START', short: 'FS', label: 'Fin → Inicio (FS)' },
  { value: 'START_TO_START', short: 'SS', label: 'Inicio → Inicio (SS)' },
  { value: 'FINISH_TO_FINISH', short: 'FF', label: 'Fin → Fin (FF)' },
  { value: 'START_TO_FINISH', short: 'SF', label: 'Inicio → Fin (SF)' },
]

// Deuda: sin sesión real aún, se usa SUPER_ADMIN hardcoded (mismo patrón
// que CalendarBoardClient / Sidebar.debugRole). Reemplazar cuando exista auth.
const DEBUG_USER_ROLES = ['SUPER_ADMIN']

export function TaskDrawerContent({ task, projects, users, allTasks = [] }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('detail')
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Form State (Detail)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [status, setStatus] = useState(task.status)
  const [priority, setPriority] = useState(task.priority)
  const [type, setType] = useState(task.type)
  const [assigneeId, setAssigneeId] = useState(task.assignee?.id || '')
  const [startDate, setStartDate] = useState(task.startDate ? task.startDate.split('T')[0] : '')
  const [endDate, setEndDate] = useState(task.endDate ? task.endDate.split('T')[0] : '')
  const [progress, setProgress] = useState(task.progress)
  const [plannedValue, setPlannedValue] = useState(task.plannedValue || 0)
  const [actualCost, setActualCost] = useState(task.actualCost || 0)

  // Tracking State
  const [comment, setComment] = useState('')
  const [isInternal, setIsInternal] = useState(false)

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

  const handleAddComment = () => {
    if (!comment.trim()) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('content', comment)
        fd.set('taskId', task.id)
        fd.set('isInternal', String(isInternal))
        fd.set('authorId', users[0]?.id || '') 
        await createComment(fd)
        setComment('')
        toast.success('Seguimiento agregado')
      } catch (err) {
        toast.error('Error al agregar seguimiento')
      }
    })
  }

  const handleSimulateUpload = () => {
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('taskId', task.id)
        fd.set('filename', 'respaldo_actividad.pdf')
        fd.set('url', 'https://example.com/file.pdf')
        await createAttachment(fd)
        toast.success('Archivo adjuntado (Simulado)')
      } catch (err) {
        toast.error('Error al adjuntar archivo')
      }
    })
  }

  const handleAddDependenciesBatch = (predecessorIds: string[], depType: DepType) => {
    if (predecessorIds.length === 0) return
    startTransition(async () => {
      const results = await Promise.allSettled(
        predecessorIds.map((predecessorId) => {
          const fd = new FormData()
          fd.set('predecessorId', predecessorId)
          fd.set('successorId', task.id)
          fd.set('type', depType)
          return addDependency(fd)
        }),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - ok
      if (ok > 0) toast.success(`${ok} relación${ok === 1 ? '' : 'es'} añadida${ok === 1 ? '' : 's'}`)
      if (failed > 0) toast.error(`${failed} relación${failed === 1 ? '' : 'es'} fallaron`)
    })
  }

  const handleRemoveDependency = (predecessorId: string, successorId: string) => {
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('predecessorId', predecessorId)
        fd.set('successorId', successorId)
        await removeDependency(fd)
        toast.success('Relación eliminada')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al eliminar relación')
      }
    })
  }

  const progressColor = progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'

  // Cálculos de alcance
  const difference = plannedValue - actualCost
  const diffColor = difference >= 0 ? 'text-emerald-400' : 'text-rose-400'

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
      <div className="flex border-b border-border mb-6 shrink-0 overflow-x-auto scrollbar-none">
        {[
          { id: 'detail', label: 'Detalle', icon: Briefcase },
          { id: 'tracking', label: 'Seguimiento', icon: MessageSquare },
          { id: 'relations', label: 'Relaciones', icon: GitBranch },
          { id: 'history', label: 'Historial', icon: History },
          { id: 'attachments', label: 'Adjuntos', icon: Paperclip },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as Tab)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-muted-foreground hover:text-foreground/90'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
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

        {activeTab === 'relations' && (
          <RelationsTab
            task={task}
            allTasks={allTasks}
            isPending={isPending}
            onAdd={handleAddDependenciesBatch}
            onRemove={handleRemoveDependency}
          />
        )}

        {activeTab === 'tracking' && (
          <section className="space-y-6">
            <div className="bg-card border border-border rounded-xl p-4 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground/90">Nuevo Seguimiento</h3>
                <div className="flex items-center gap-1 bg-background rounded-lg p-1 border border-border">
                  <button 
                    onClick={() => setIsInternal(false)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${!isInternal ? 'bg-indigo-600 text-white' : 'text-muted-foreground hover:text-foreground/90'}`}
                  >
                    <Globe className="h-3 w-3" /> Externo
                  </button>
                  <button 
                    onClick={() => setIsInternal(true)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${isInternal ? 'bg-amber-600 text-white' : 'text-muted-foreground hover:text-foreground/90'}`}
                  >
                    <ShieldCheck className="h-3 w-3" /> Interno
                  </button>
                </div>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Escribe tu actualización... Usa @ para mencionar."
                className="w-full bg-background border border-border rounded-lg px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none h-28"
              />
              <div className="flex justify-between items-center">
                <p className="text-[11px] text-muted-foreground max-w-[200px]">Menciona @usuario para enviar alerta automática.</p>
                <button 
                  onClick={handleAddComment}
                  disabled={isPending || !comment.trim()}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all shadow-lg"
                >
                  <Send className="h-4 w-4" /> Enviar
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {task.comments?.map((c) => (
                <div key={c.id} className={`p-4 rounded-xl border relative overflow-hidden ${c.isInternal ? 'bg-amber-500/5 border-amber-500/20' : 'bg-card border-border'}`}>
                  {c.isInternal && <div className="absolute top-0 right-0 h-1 w-20 bg-amber-500 opacity-50" />}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-indigo-400 border border-border">
                        {c.author?.name?.charAt(0) || '?'}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-foreground">{c.author?.name || 'Sistema'}</span>
                        <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    {c.isInternal && (
                      <span className="flex items-center gap-1 text-[9px] font-black bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full uppercase tracking-tighter border border-amber-500/30">
                        <ShieldCheck className="h-2.5 w-2.5" /> Seguimiento Interno
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/90 leading-relaxed pl-9">
                    {c.content.split(/(@[\w.-]+@[\w.-]+\.\w+|@[\w.-]+)/g).map((part, i) => 
                      part.startsWith('@') ? <span key={i} className="text-indigo-400 font-bold underline decoration-indigo-500/30 cursor-help" title="Usuario mencionado">{part}</span> : part
                    )}
                  </p>
                </div>
              ))}
              {(!task.comments || task.comments.length === 0) && (
                <div className="text-center py-8">
                   <MessageSquare className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
                   <p className="text-muted-foreground text-xs italic">Aún no hay actualizaciones registradas.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'history' && (
          <section className="space-y-4">
            <div className="space-y-0 relative before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-[2px] before:bg-secondary/50">
              {task.history?.map((h) => (
                <div key={h.id} className="relative pl-10 pb-8 group">
                  <div className="absolute left-0 top-1 h-8 w-8 rounded-full bg-background border-2 border-border flex items-center justify-center z-10 group-hover:border-indigo-500 transition-all">
                    <History className="h-3.5 w-3.5 text-muted-foreground group-hover:text-indigo-400" />
                  </div>
                  <div className="bg-card/40 border border-border/50 rounded-xl p-4 text-sm group-hover:border-border transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                         <span className="font-black text-xs text-indigo-400 uppercase tracking-widest">{h.field}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-medium">{new Date(h.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Modificado por <span className="text-foreground font-bold">@{h.user?.name || 'Sistema'}</span>
                    </p>
                    <div className="flex items-center gap-3 font-mono text-[11px] p-2 bg-background/95 rounded border border-border/50">
                      <span className="text-rose-400/70 line-through truncate max-w-[120px]">{h.oldValue || '(vacio)'}</span>
                      <ChevronRight className="h-3 w-3 text-foreground shrink-0" />
                      <span className="text-emerald-400 truncate max-w-[120px]">{h.newValue || '(vacio)'}</span>
                    </div>
                  </div>
                </div>
              ))}
              {(!task.history || task.history.length === 0) && (
                <div className="text-center py-12">
                   <Activity className="h-12 w-12 text-foreground mx-auto mb-3" />
                   <p className="text-muted-foreground text-sm italic">No hay historial de cambios aún.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'attachments' && (
          <section className="space-y-6">
            <div 
              className="border-2 border-dashed border-border rounded-2xl p-10 text-center space-y-4 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all cursor-pointer group" 
              onClick={handleSimulateUpload}
            >
              <div className="h-14 w-14 rounded-full bg-card border border-border flex items-center justify-center mx-auto group-hover:scale-110 transition-transform shadow-lg">
                <Paperclip className="h-6 w-6 text-muted-foreground group-hover:text-indigo-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Subir archivos de respaldo</p>
                <p className="text-[11px] text-muted-foreground mt-1 uppercase tracking-tighter">Documenta tus actividades realizadas</p>
              </div>
              <button className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-indigo-500 transition-colors shadow-lg">Seleccionar Archivos</button>
            </div>

            <div className="space-y-3">
              {task.attachments?.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-4 bg-card border border-border rounded-xl group hover:bg-secondary/50 transition-all border-l-4 border-l-indigo-500">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                      <FileIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground group-hover:text-indigo-300 transition-colors">{a.filename}</p>
                      <p className="text-[10px] text-muted-foreground font-medium">
                        Subido por {a.user?.name || 'Sistema'} · {new Date(a.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="p-2 bg-background rounded-lg text-muted-foreground hover:text-white transition-colors border border-border">
                       <Link2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {(!task.attachments || task.attachments.length === 0) && (
                <div className="text-center py-8">
                   <Paperclip className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
                   <p className="text-muted-foreground text-xs italic">No hay archivos adjuntos aún.</p>
                </div>
              )}
            </div>
          </section>
        )}

      </div>
    </article>
  )
}

// ─────────────────────────────────────────────────────────────
// Subcomponente: Pestaña Relaciones (predecesoras/sucesoras)
// ─────────────────────────────────────────────────────────────

type RelationsTabProps = {
  task: SerializedTask
  allTasks: SerializedTask[]
  isPending: boolean
  onAdd: (predecessorIds: string[], type: DepType) => void
  onRemove: (predecessorId: string, successorId: string) => void
}

function RelationsTab({ task, allTasks, isPending, onAdd, onRemove }: RelationsTabProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [depType, setDepType] = useState<DepType>('FINISH_TO_START')

  const existingPredIds = useMemo(
    () => new Set((task.predecessors ?? []).map((p: { predecessorId: string }) => p.predecessorId)),
    [task.predecessors],
  )

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allTasks
      .filter((t) => t.id !== task.id && !existingPredIds.has(t.id))
      .filter((t) => {
        if (!q) return true
        const mnemonic = (t.mnemonic || '').toLowerCase()
        return mnemonic.includes(q) || t.title.toLowerCase().includes(q)
      })
      .slice(0, 50) // cap para no saturar el listado en proyectos grandes
  }, [allTasks, task.id, existingPredIds, query])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addBatch = () => {
    if (selected.size === 0) return
    onAdd(Array.from(selected), depType)
    setSelected(new Set())
    setQuery('')
  }

  const depShort = (t: DepType) => DEP_TYPES.find((d) => d.value === t)?.short ?? t

  return (
    <section className="space-y-8">
      {/* Predecesoras */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-foreground/90 flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-indigo-500 rotate-90" />
          Predecesoras (Tareas que bloquean a esta)
        </h3>
        <div className="space-y-2">
          {task.predecessors?.map((p: { id: string; predecessorId: string; type?: DepType; predecessor: { mnemonic?: string | null; id: string; title: string } }) => (
            <div key={p.id} className="flex items-center justify-between p-3 bg-subtle/50 border border-border rounded-lg group">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">
                  {p.predecessor.mnemonic || p.predecessor.id.substring(0, 6)}
                </span>
                {p.type && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 rounded shrink-0" title={DEP_TYPES.find((d) => d.value === p.type)?.label}>
                    {depShort(p.type)}
                  </span>
                )}
                <span className="text-sm text-foreground/90 truncate">{p.predecessor.title}</span>
              </div>
              <button
                onClick={() => onRemove(p.predecessorId, task.id)}
                disabled={isPending}
                className="p-1.5 text-muted-foreground hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30 shrink-0"
                aria-label="Eliminar predecesora"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {(!task.predecessors || task.predecessors.length === 0) && (
            <p className="text-xs text-muted-foreground italic pl-6">No hay predecesoras definidas.</p>
          )}
        </div>
      </div>

      {/* Sucesoras */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-foreground/90 flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-indigo-500" />
          Sucesoras (Tareas bloqueadas por esta)
        </h3>
        <div className="space-y-2">
          {task.successors?.map((s: { id: string; successorId: string; type?: DepType; successor: { mnemonic?: string | null; id: string; title: string } }) => (
            <div key={s.id} className="flex items-center justify-between p-3 bg-subtle/50 border border-border rounded-lg group">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0">
                  {s.successor.mnemonic || s.successor.id.substring(0, 6)}
                </span>
                {s.type && (
                  <span className="text-[9px] font-black uppercase tracking-widest text-amber-300 bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 rounded shrink-0" title={DEP_TYPES.find((d) => d.value === s.type)?.label}>
                    {depShort(s.type)}
                  </span>
                )}
                <span className="text-sm text-foreground/90 truncate">{s.successor.title}</span>
              </div>
              <button
                onClick={() => onRemove(task.id, s.successorId)}
                disabled={isPending}
                className="p-1.5 text-muted-foreground hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30 shrink-0"
                aria-label="Eliminar sucesora"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {(!task.successors || task.successors.length === 0) && (
            <p className="text-xs text-muted-foreground italic pl-6">No hay sucesoras definidas.</p>
          )}
        </div>
      </div>

      {/* Añadir múltiples predecesoras */}
      <div className="pt-4 border-t border-border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">
            Añadir predecesoras {selected.size > 0 && <span className="text-indigo-400">· {selected.size} seleccionada{selected.size === 1 ? '' : 's'}</span>}
          </p>
          <select
            value={depType}
            onChange={(e) => setDepType(e.target.value as DepType)}
            disabled={isPending}
            className="bg-input border border-border rounded px-2 py-1 text-[11px] text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Tipo de dependencia"
          >
            {DEP_TYPES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por mnemónico o título..."
          className="w-full bg-input border border-border rounded-lg px-3 py-2 text-xs text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="max-h-60 overflow-y-auto custom-scrollbar rounded-lg border border-border divide-y divide-border/50">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground italic p-4 text-center">
              {query ? 'Ninguna tarea coincide con la búsqueda.' : 'No hay tareas disponibles para agregar.'}
            </p>
          ) : (
            candidates.map((t) => {
              const isSel = selected.has(t.id)
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${isSel ? 'bg-indigo-500/10' : 'hover:bg-secondary/50'}`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(t.id)}
                    className="h-3.5 w-3.5 accent-indigo-500 cursor-pointer"
                  />
                  <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">
                    {t.mnemonic || t.id.substring(0, 6)}
                  </span>
                  <span className="text-xs text-foreground/90 truncate">{t.title}</span>
                </label>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              disabled={isPending}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground/90 transition-colors"
            >
              Limpiar
            </button>
          )}
          <button
            onClick={addBatch}
            disabled={isPending || selected.size === 0}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            {selected.size === 0 ? 'Añadir relación' : `Añadir ${selected.size} relación${selected.size === 1 ? '' : 'es'}`}
          </button>
        </div>
      </div>
    </section>
  )
}
