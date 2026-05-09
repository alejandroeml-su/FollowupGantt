'use client'

/**
 * KPI Dashboard filters · Wave P13 (Filters UX) — refactor a estructura
 * estándar expandible/colapsable + grid 4-col + chips activos +
 * Limpiar/Aplicar (compartida con TaskFiltersBar y AuditFilters).
 *
 * Persiste el estado en URL searchParams (igual que antes) para que el
 * deep-link siga funcionando. El expand/collapse se sincroniza con el
 * UIStore para que el usuario mantenga su preferencia entre vistas.
 */

import { useMemo, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Filter,
  Loader2,
  X,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { KPIFilterOptions } from '@/lib/kpi-calc'
import { useUIStore } from '@/lib/stores/ui'

type Props = {
  options: KPIFilterOptions
}

const STATUS_OPTIONS = [
  { value: 'TODO', label: 'Por hacer' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'REVIEW', label: 'En revisión' },
  { value: 'DONE', label: 'Completado' },
] as const

const TYPE_OPTIONS = [
  { value: 'AGILE_STORY', label: 'Historia Ágil' },
  { value: 'PMI_TASK', label: 'Tarea PMI' },
  { value: 'ITIL_TICKET', label: 'Ticket ITIL' },
] as const

const FILTER_KEYS = [
  'gerencia',
  'area',
  'project',
  'status',
  'type',
  'assignee',
  'priority',
  'epic',
  'from',
  'to',
] as const

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'CRITICAL', label: 'Crítica' },
] as const

export function KPIFilters({ options }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const expanded = useUIStore((s) => s.filtersExpanded)
  const toggleExpanded = useUIStore((s) => s.toggleFiltersExpanded)
  const dateRangeOpen = useUIStore((s) => s.filtersDateRangeOpen)
  const toggleDateRange = useUIStore((s) => s.toggleFiltersDateRange)

  const currentGerencia = searchParams.get('gerencia') ?? ''
  const currentArea = searchParams.get('area') ?? ''
  const currentProject = searchParams.get('project') ?? ''
  const currentStatus = searchParams.get('status') ?? ''
  const currentType = searchParams.get('type') ?? ''
  const currentPriority = searchParams.get('priority') ?? ''
  const currentAssignee = searchParams.get('assignee') ?? ''
  const currentEpic = searchParams.get('epic') ?? ''
  const currentFrom = searchParams.get('from') ?? ''
  const currentTo = searchParams.get('to') ?? ''

  const filteredAreas = useMemo(
    () =>
      currentGerencia
        ? options.areas.filter((a) => a.gerenciaId === currentGerencia)
        : options.areas,
    [options.areas, currentGerencia],
  )

  const filteredProjects = useMemo(() => {
    if (currentArea)
      return options.projects.filter((p) => p.areaId === currentArea)
    if (currentGerencia) {
      const areaIds = new Set(filteredAreas.map((a) => a.id))
      return options.projects.filter((p) => p.areaId && areaIds.has(p.areaId))
    }
    return options.projects
  }, [options.projects, currentArea, currentGerencia, filteredAreas])

  const activeCount = [
    currentGerencia,
    currentArea,
    currentProject,
    currentStatus,
    currentType,
    currentPriority,
    currentAssignee,
    currentEpic,
    currentFrom,
    currentTo,
  ].filter(Boolean).length

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)

    if (key === 'gerencia') {
      next.delete('area')
      next.delete('project')
    }
    if (key === 'area') next.delete('project')

    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    })
  }

  const clearAll = () => {
    const next = new URLSearchParams(searchParams.toString())
    FILTER_KEYS.forEach((k) => next.delete(k))
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    })
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
  const labelClass =
    'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5'

  type Chip = { key: (typeof FILTER_KEYS)[number]; label: string }
  const chips: Chip[] = []
  if (currentGerencia) {
    const g = options.gerencias.find((x) => x.id === currentGerencia)
    chips.push({ key: 'gerencia', label: `Departamento: ${g?.name ?? currentGerencia}` })
  }
  if (currentArea) {
    const a = options.areas.find((x) => x.id === currentArea)
    chips.push({ key: 'area', label: `Área: ${a?.name ?? currentArea}` })
  }
  if (currentProject) {
    const p = options.projects.find((x) => x.id === currentProject)
    chips.push({ key: 'project', label: `Proyecto: ${p?.name ?? currentProject}` })
  }
  if (currentStatus) {
    const s = STATUS_OPTIONS.find((o) => o.value === currentStatus)
    chips.push({ key: 'status', label: `Estado: ${s?.label ?? currentStatus}` })
  }
  if (currentType) {
    const ty = TYPE_OPTIONS.find((o) => o.value === currentType)
    chips.push({ key: 'type', label: `Tipo: ${ty?.label ?? currentType}` })
  }
  if (currentPriority) {
    const pr = PRIORITY_OPTIONS.find((o) => o.value === currentPriority)
    chips.push({ key: 'priority', label: `Prioridad: ${pr?.label ?? currentPriority}` })
  }
  if (currentAssignee) {
    const u = options.users.find((x) => x.id === currentAssignee)
    chips.push({ key: 'assignee', label: `Asignado: ${u?.name ?? currentAssignee}` })
  }
  if (currentFrom) chips.push({ key: 'from', label: `Desde: ${currentFrom}` })
  if (currentTo) chips.push({ key: 'to', label: `Hasta: ${currentTo}` })

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-border/60">
        <button
          type="button"
          onClick={() => toggleExpanded()}
          aria-expanded={expanded}
          className="flex items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Filtros</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300">
              {activeCount} activo{activeCount === 1 ? '' : 's'}
            </span>
          )}
          {isPending && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            disabled={activeCount === 0 || isPending}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors',
              activeCount > 0 && !isPending
                ? 'text-foreground hover:bg-secondary'
                : 'text-muted-foreground/50 cursor-not-allowed',
            )}
          >
            <X className="h-3.5 w-3.5" />
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => toggleExpanded(false)}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Aplicar
          </button>
        </div>
      </header>

      {expanded && (
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass}>Departamento</label>
              <select
                value={currentGerencia}
                onChange={(e) => updateParam('gerencia', e.target.value)}
                className={inputClass}
              >
                <option value="">Todos</option>
                {options.gerencias.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Área</label>
              <select
                value={currentArea}
                onChange={(e) => updateParam('area', e.target.value)}
                disabled={filteredAreas.length === 0}
                className={inputClass}
              >
                <option value="">Todas</option>
                {filteredAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Proyecto</label>
              <select
                value={currentProject}
                onChange={(e) => updateParam('project', e.target.value)}
                disabled={filteredProjects.length === 0}
                className={inputClass}
              >
                <option value="">Todos</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Estado</label>
              <select
                value={currentStatus}
                onChange={(e) => updateParam('status', e.target.value)}
                className={inputClass}
              >
                <option value="">Todos</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Tipo</label>
              <select
                value={currentType}
                onChange={(e) => updateParam('type', e.target.value)}
                className={inputClass}
              >
                <option value="">Todos</option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Prioridad</label>
              <select
                value={currentPriority}
                onChange={(e) => updateParam('priority', e.target.value)}
                className={inputClass}
              >
                <option value="">Todas</option>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Asignado</label>
              <select
                value={currentAssignee}
                onChange={(e) => updateParam('assignee', e.target.value)}
                className={inputClass}
              >
                <option value="">Cualquiera</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Epic</label>
              <select
                value={currentEpic}
                onChange={(e) => updateParam('epic', e.target.value)}
                className={inputClass}
              >
                <option value="">Todos</option>
              </select>
            </div>
          </div>

          <div className="border-t border-border/60 pt-3">
            <button
              type="button"
              onClick={() => toggleDateRange()}
              aria-expanded={dateRangeOpen}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {dateRangeOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
              <CalendarIcon className="h-3.5 w-3.5" />
              Rango de fechas
              {(currentFrom || currentTo) && (
                <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">
                  activo
                </span>
              )}
            </button>
            {dateRangeOpen && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:gap-x-6">
                <div>
                  <label className={labelClass}>Desde</label>
                  <input
                    type="date"
                    value={currentFrom}
                    onChange={(e) => updateParam('from', e.target.value)}
                    className={inputClass}
                    max={currentTo || undefined}
                  />
                </div>
                <div>
                  <label className={labelClass}>hasta</label>
                  <input
                    type="date"
                    value={currentTo}
                    onChange={(e) => updateParam('to', e.target.value)}
                    className={inputClass}
                    min={currentFrom || undefined}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/20 px-5 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">
            Activos:
          </span>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => updateParam(c.key, '')}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25"
            >
              {c.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </footer>
      )}
    </section>
  )
}
