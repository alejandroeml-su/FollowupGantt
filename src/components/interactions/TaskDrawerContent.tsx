'use client'

import { useState, useTransition } from 'react'
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
  X as CloseIcon
} from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import StatusSelector from '@/components/StatusSelector'
import { TaskBreadcrumbs } from './TaskDrawer'
import { updateTask } from '@/lib/actions'
import { toast } from './Toaster'

type Props = {
  task: SerializedTask
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
}

/**
 * Contenido del Drawer lateral para una tarea.
 * Implementa las 5 secciones requeridas: Jerarquía, Contexto, Responsabilidades, Tiempos y Fechas, Indicadores.
 * Soporta modo de edición para todos los campos clave.
 */
export function TaskDrawerContent({ task, projects, users }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Form State
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
        fd.set('endDate', endDate)
        fd.set('progress', String(progress))
        fd.set('plannedValue', String(plannedValue))
        fd.set('actualCost', String(actualCost))
        
        await updateTask(fd)
        setIsEditing(false)
        toast.success('Tarea actualizada correctamente')
      } catch (err) {
        toast.error('Error al actualizar la tarea')
        console.error(err)
      }
    })
  }

  const startDateStr = task.startDate
    ? new Date(task.startDate).toLocaleDateString()
    : 'Sin definir'
  const endDateStr = task.endDate
    ? new Date(task.endDate).toLocaleDateString()
    : 'Sin definir'
  const updatedAtStr = task.updatedAt
    ? new Date(task.updatedAt).toLocaleDateString()
    : '-'

  const hasTags = task.tags && task.tags.length > 0
  const progressColor = progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'

  return (
    <article aria-labelledby={`drawer-title-${task.id}`} className="space-y-8 pb-10">
      
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <TaskBreadcrumbs
          segments={[
            ...(task.project ? [{ label: task.project.name }] : []),
            { label: `Tarea #${task.id.substring(0, 6)}` },
          ]}
        />
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                onClick={() => setIsEditing(false)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-slate-800 transition-colors"
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
              className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            >
              <Edit2 className="h-3.5 w-3.5" /> Editar
            </button>
          )}
        </div>
      </div>

      {/* 1. Identificación y Jerarquía */}
      <section className="space-y-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs font-mono font-medium text-slate-400">
              <Hash className="h-3 w-3" />
              {task.id.substring(0, 8).toUpperCase()}
            </span>
            {task.parentId && (
              <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-xs font-medium text-indigo-400 cursor-pointer hover:bg-indigo-500/20 transition-colors">
                <Link2 className="h-3 w-3" />
                Subtarea de #{task.parentId.substring(0, 6)}
              </span>
            )}
          </div>
          
          {isEditing ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-xl font-bold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Título de la tarea"
            />
          ) : (
            <h2
              id={`drawer-title-${task.id}`}
              className="text-xl font-bold leading-tight text-white"
            >
              {task.title}
            </h2>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Descripción
          </h3>
          {isEditing ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Añade una descripción detallada..."
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-slate-300">
              {task.description || 'Sin descripción.'}
            </p>
          )}
        </div>
      </section>

      {/* 2. Clasificación y Contexto */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
          <Briefcase className="h-4 w-4" /> Clasificación y Contexto
        </h3>
        <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <dt className="flex items-center gap-2 text-slate-500">Tipo de Tarea</dt>
          <dd className="font-medium text-slate-200">
            {isEditing ? (
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none"
              >
                <option value="AGILE_STORY">Agile Story</option>
                <option value="PMI_TASK">PMI Task</option>
                <option value="ITIL_TICKET">ITIL Ticket</option>
              </select>
            ) : (
              <>
                {task.type === 'AGILE_STORY' ? 'Agile Story' : task.type === 'PMI_TASK' ? 'PMI Task' : 'ITIL Ticket'}
                {task.isMilestone && <span className="ml-2 text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">Hito</span>}
              </>
            )}
          </dd>

          <dt className="flex items-center gap-2 text-slate-500">Estado</dt>
          <dd>
            {isEditing ? (
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none"
              >
                <option value="TODO">To Do</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="REVIEW">Review</option>
                <option value="DONE">Done</option>
              </select>
            ) : (
              <StatusSelector taskId={task.id} currentStatus={task.status} />
            )}
          </dd>

          <dt className="flex items-center gap-2 text-slate-500">Prioridad</dt>
          <dd className="flex items-center gap-1.5 font-medium text-slate-200">
            {isEditing ? (
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            ) : (
              <>
                <Flag className="h-4 w-4 text-slate-400" />
                {task.priority}
              </>
            )}
          </dd>

          <dt className="flex items-center gap-2 text-slate-500 mt-1">Etiquetas</dt>
          <dd className="flex flex-wrap gap-1.5 mt-1">
            {hasTags ? (
              task.tags!.map(t => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                  <Tag className="h-3 w-3" /> {t}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-600">Sin etiquetas</span>
            )}
          </dd>
        </dl>
      </section>

      {/* 3. Responsabilidades */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
          <UserCircle2 className="h-4 w-4" /> Responsabilidades
        </h3>
        <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <dt className="flex items-center gap-2 text-slate-500">Responsable</dt>
          <dd className="font-medium text-slate-200 flex items-center gap-2">
            {isEditing ? (
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none"
              >
                <option value="">Sin asignar</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            ) : (
              <>
                <div className="h-5 w-5 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/50">
                  <span className="text-[10px] text-indigo-300 font-bold">{task.assignee?.name?.charAt(0) || '?'}</span>
                </div>
                {task.assignee?.name ?? 'Sin asignar'}
              </>
            )}
          </dd>

          <dt className="flex items-center gap-2 text-slate-500">Informador</dt>
          <dd className="text-slate-400">
            Sistema / Creador
          </dd>
        </dl>
      </section>

      {/* 4. Tiempos y Fechas */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
          <Calendar className="h-4 w-4" /> Tiempos y Fechas
        </h3>
        <dl className="grid grid-cols-[140px_1fr] gap-y-3 text-sm">
          <dt className="flex items-center gap-2 text-slate-500">Inicio Planeado</dt>
          <dd className="text-slate-200">
            {isEditing ? (
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none"
              />
            ) : startDateStr}
          </dd>

          <dt className="flex items-center gap-2 text-slate-500">Fecha de Entrega</dt>
          <dd className="text-slate-200 font-medium">
            {isEditing ? (
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none"
              />
            ) : endDateStr}
          </dd>

          <dt className="flex items-center gap-2 text-slate-500">Finalización Real</dt>
          <dd className="text-slate-200">{task.status === 'DONE' ? updatedAtStr : '-'}</dd>

          <dt className="flex items-center gap-2 text-slate-500 mt-2">Estimación (Hrs)</dt>
          <dd className="text-slate-200 mt-2 font-mono bg-slate-800/50 px-2 py-0.5 rounded w-fit">
            {isEditing ? (
              <input
                type="number"
                value={plannedValue}
                onChange={(e) => setPlannedValue(Number(e.target.value))}
                className="bg-transparent border-none w-16 focus:outline-none"
              />
            ) : (
              <>{task.plannedValue != null ? task.plannedValue : '0.0'}</>
            )} h
          </dd>

          <dt className="flex items-center gap-2 text-slate-500">Tiempo Invertido</dt>
          <dd className="text-slate-200 font-mono bg-slate-800/50 px-2 py-0.5 rounded w-fit">
            {isEditing ? (
              <input
                type="number"
                value={actualCost}
                onChange={(e) => setActualCost(Number(e.target.value))}
                className="bg-transparent border-none w-16 focus:outline-none"
              />
            ) : (
              <>{task.actualCost != null ? task.actualCost : '0.0'}</>
            )} h
          </dd>
        </dl>
      </section>

      {/* 5. Indicadores de Seguimiento */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
          <Activity className="h-4 w-4" /> Indicadores de Seguimiento
        </h3>
        
        <div className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-sm text-slate-500 flex items-center gap-2">
                % de Avance
              </span>
              <span className="text-xs font-bold text-slate-300">{progress}%</span>
            </div>
            {isEditing ? (
              <input
                type="range"
                min="0"
                max="100"
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            ) : (
              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                <AlertCircle className="h-3.5 w-3.5" /> Dependencias
              </h4>
              <p className="text-xs text-slate-400">
                Ninguna tarea bloqueante registrada.
              </p>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                <CheckSquare className="h-3.5 w-3.5" /> Aceptación
              </h4>
              <p className="text-xs text-slate-400">
                Aprobación del PM requerida al finalizar.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Subtareas */}
      {!!task.subtasks?.length && !isEditing && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">
            Subtareas ({task.subtasks.length})
          </h3>
          <ul className="space-y-2">
            {task.subtasks.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm hover:border-slate-700 transition-colors cursor-pointer group"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-slate-200 group-hover:text-indigo-300 transition-colors">
                    {s.title}
                  </span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest">
                    #{s.id.substring(0,6)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                    {s.status}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}
