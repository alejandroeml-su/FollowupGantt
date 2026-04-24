'use client'

import { useMemo, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { X, SlidersHorizontal, Loader2 } from 'lucide-react'
import type { KPIFilterOptions } from '@/lib/kpi-calc'

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

const FILTER_KEYS = ['gerencia', 'area', 'project', 'status', 'type', 'assignee'] as const

export function KPIFilters({ options }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const currentGerencia = searchParams.get('gerencia') ?? ''
  const currentArea = searchParams.get('area') ?? ''
  const currentProject = searchParams.get('project') ?? ''
  const currentStatus = searchParams.get('status') ?? ''
  const currentType = searchParams.get('type') ?? ''
  const currentAssignee = searchParams.get('assignee') ?? ''

  const filteredAreas = useMemo(
    () =>
      currentGerencia
        ? options.areas.filter((a) => a.gerenciaId === currentGerencia)
        : options.areas,
    [options.areas, currentGerencia],
  )

  const filteredProjects = useMemo(() => {
    if (currentArea) return options.projects.filter((p) => p.areaId === currentArea)
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
    currentAssignee,
  ].filter(Boolean).length

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)

    // Dependencias: al cambiar gerencia/area, limpiar hijos
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

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-5 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
          <span>Filtros del portafolio</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
              {activeCount} activo{activeCount !== 1 ? 's' : ''}
            </span>
          )}
          {isPending && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
        </div>
        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 rounded-md border border-slate-700/60 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
          >
            <X className="h-3 w-3" />
            Limpiar
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <FilterSelect
          label="Gerencia"
          value={currentGerencia}
          onChange={(v) => updateParam('gerencia', v)}
          placeholder="Todas"
          options={options.gerencias.map((g) => ({ value: g.id, label: g.name }))}
        />
        <FilterSelect
          label="Área"
          value={currentArea}
          onChange={(v) => updateParam('area', v)}
          placeholder="Todas"
          options={filteredAreas.map((a) => ({ value: a.id, label: a.name }))}
          disabled={filteredAreas.length === 0}
        />
        <FilterSelect
          label="Proyecto"
          value={currentProject}
          onChange={(v) => updateParam('project', v)}
          placeholder="Todos"
          options={filteredProjects.map((p) => ({ value: p.id, label: p.name }))}
          disabled={filteredProjects.length === 0}
        />
        <FilterSelect
          label="Estado"
          value={currentStatus}
          onChange={(v) => updateParam('status', v)}
          placeholder="Todos"
          options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
        />
        <FilterSelect
          label="Tipo"
          value={currentType}
          onChange={(v) => updateParam('type', v)}
          placeholder="Todos"
          options={TYPE_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
        />
        <FilterSelect
          label="Asignado a"
          value={currentAssignee}
          onChange={(v) => updateParam('assignee', v)}
          placeholder="Todos"
          options={options.users.map((u) => ({ value: u.id, label: u.name }))}
        />
      </div>
    </div>
  )
}

type SelectOption = { value: string; label: string }

function FilterSelect({
  label,
  value,
  onChange,
  placeholder,
  options,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  options: SelectOption[]
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-lg border border-slate-700/70 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 transition focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
