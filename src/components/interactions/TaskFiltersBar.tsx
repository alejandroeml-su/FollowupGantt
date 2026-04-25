'use client'

import { useMemo } from 'react'
import { Filter, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { TaskFilters } from '@/lib/taskFilters'
import { countActiveFilters, EMPTY_TASK_FILTERS, UNASSIGNED_VALUE } from '@/lib/taskFilters'

type Catalogs = {
  gerencias?: { id: string; name: string }[]
  areas?: { id: string; name: string; gerenciaId?: string | null }[]
  projects?: { id: string; name: string; areaId?: string | null }[]
  users?: { id: string; name: string }[]
}

type Props = Catalogs & {
  value: TaskFilters
  onChange: (next: TaskFilters) => void
  /** Controla qué filtros mostrar (todos por defecto). */
  show?: Partial<Record<keyof TaskFilters, boolean>>
  className?: string
}

const STATUS_OPTIONS = [
  { value: 'TODO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'REVIEW', label: 'Review' },
  { value: 'DONE', label: 'Done' },
]

const TYPE_OPTIONS = [
  { value: 'AGILE_STORY', label: 'Agile Story' },
  { value: 'PMI_TASK', label: 'PMI Task' },
  { value: 'ITIL_TICKET', label: 'ITIL Ticket' },
]

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'CRITICAL', label: 'Crítica' },
]

export function TaskFiltersBar({
  value,
  onChange,
  gerencias = [],
  areas = [],
  projects = [],
  users = [],
  show,
  className,
}: Props) {
  const visible = (key: keyof TaskFilters) => show?.[key] !== false
  const active = countActiveFilters(value)

  // Las áreas disponibles dependen de la gerencia seleccionada.
  const visibleAreas = useMemo(() => {
    if (!value.gerenciaId) return areas
    return areas.filter((a) => a.gerenciaId === value.gerenciaId)
  }, [areas, value.gerenciaId])

  // Los proyectos se filtran por área si hay una seleccionada.
  const visibleProjects = useMemo(() => {
    if (!value.areaId) return projects
    return projects.filter((p) => p.areaId === value.areaId)
  }, [projects, value.areaId])

  const set = <K extends keyof TaskFilters>(key: K, v: TaskFilters[K]) => {
    const next: TaskFilters = { ...value, [key]: v || undefined }
    // Si cambia gerencia, resetear área y proyecto si ya no son consistentes.
    if (key === 'gerenciaId') {
      if (v) {
        const areaOk = areas.find(a => a.id === next.areaId && a.gerenciaId === v)
        if (!areaOk) next.areaId = undefined
        const projOk = projects.find(p => p.id === next.projectId)
        const projArea = projOk ? areas.find(a => a.id === projOk.areaId) : null
        if (projOk && projArea?.gerenciaId !== v) next.projectId = undefined
      }
    }
    if (key === 'areaId') {
      if (v) {
        const projOk = projects.find(p => p.id === next.projectId && p.areaId === v)
        if (!projOk) next.projectId = undefined
      }
    }
    onChange(next)
  }

  const reset = () => onChange(EMPTY_TASK_FILTERS)

  const selectClass =
    'rounded-md border border-border bg-background py-1.5 px-2 text-xs text-foreground focus:border-primary focus:outline-none min-w-[110px]'

  return (
    <div className={clsx('flex flex-wrap items-center gap-2 px-6 py-3 border-b border-border bg-muted/20', className)}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Filter className="h-3.5 w-3.5" />
        Filtros
      </div>

      {visible('gerenciaId') && gerencias.length > 0 && (
        <select
          value={value.gerenciaId ?? ''}
          onChange={(e) => set('gerenciaId', e.target.value)}
          className={selectClass}
          aria-label="Gerencia"
        >
          <option value="">Gerencia</option>
          {gerencias.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      )}

      {visible('areaId') && areas.length > 0 && (
        <select
          value={value.areaId ?? ''}
          onChange={(e) => set('areaId', e.target.value)}
          className={selectClass}
          aria-label="Área"
        >
          <option value="">Área</option>
          {visibleAreas.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      )}

      {visible('projectId') && projects.length > 0 && (
        <select
          value={value.projectId ?? ''}
          onChange={(e) => set('projectId', e.target.value)}
          className={selectClass}
          aria-label="Proyecto"
        >
          <option value="">Proyecto</option>
          {visibleProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {visible('status') && (
        <select
          value={value.status ?? ''}
          onChange={(e) => set('status', e.target.value)}
          className={selectClass}
          aria-label="Estado"
        >
          <option value="">Estado</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {visible('type') && (
        <select
          value={value.type ?? ''}
          onChange={(e) => set('type', e.target.value)}
          className={selectClass}
          aria-label="Tipo"
        >
          <option value="">Tipo</option>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {visible('priority') && (
        <select
          value={value.priority ?? ''}
          onChange={(e) => set('priority', e.target.value)}
          className={selectClass}
          aria-label="Prioridad"
        >
          <option value="">Prioridad</option>
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {visible('assigneeId') && users.length > 0 && (
        <select
          value={value.assigneeId ?? ''}
          onChange={(e) => set('assigneeId', e.target.value)}
          className={selectClass}
          aria-label="Asignado"
        >
          <option value="">Asignado</option>
          <option value={UNASSIGNED_VALUE}>Sin asignar</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      )}

      {(visible('dateFrom') || visible('dateTo')) && (
        <div className="flex items-center gap-1.5 pl-2 ml-1 border-l border-border/60">
          {visible('dateFrom') && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Desde
              <input
                type="date"
                value={value.dateFrom ?? ''}
                onChange={(e) => set('dateFrom', e.target.value)}
                className={selectClass}
                aria-label="Fecha desde"
                max={value.dateTo || undefined}
              />
            </label>
          )}
          {visible('dateTo') && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Hasta
              <input
                type="date"
                value={value.dateTo ?? ''}
                onChange={(e) => set('dateTo', e.target.value)}
                className={selectClass}
                aria-label="Fecha hasta"
                min={value.dateFrom || undefined}
              />
            </label>
          )}
        </div>
      )}

      {active > 0 && (
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors ml-auto"
        >
          <X className="h-3 w-3" />
          Limpiar ({active})
        </button>
      )}
    </div>
  )
}
