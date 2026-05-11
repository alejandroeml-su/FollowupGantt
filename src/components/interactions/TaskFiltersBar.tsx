'use client'

/**
 * Wave P13 (Filters UX) — Panel estándar de filtros expandible/colapsable.
 *
 * Estructura de la spec:
 *   1. Header con "Filtros · N activos" + botones Limpiar/Aplicar.
 *   2. Grid 4-col con selects (Departamento/Área/Proyecto/Estado/Tipo/Prioridad/Asignado/Epic).
 *   3. Sub-sección Rango de fechas con toggle propio.
 *   4. Chips activos al pie + botón Limpiar individual por chip.
 *
 * El expand/collapse + el toggle de rango de fechas se persisten en el
 * UIStore para que el usuario mantenga su preferencia entre vistas.
 *
 * API mantiene compat con el componente anterior (mismas props): los
 * callers no necesitan cambios, solo se beneficia visualmente.
 */

import { useMemo } from 'react'
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Filter,
  X,
  Zap,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { TaskFilters } from '@/lib/taskFilters'
import {
  countActiveFilters,
  EMPTY_TASK_FILTERS,
  UNASSIGNED_VALUE,
  NO_EPIC_VALUE,
} from '@/lib/taskFilters'
import { useUIStore } from '@/lib/stores/ui'
import { useTranslation } from '@/lib/i18n/use-translation'

type Catalogs = {
  gerencias?: { id: string; name: string }[]
  areas?: { id: string; name: string; gerenciaId?: string | null }[]
  projects?: { id: string; name: string; areaId?: string | null }[]
  users?: { id: string; name: string }[]
  /** Wave P9 — Epics disponibles (filtrables por proyecto seleccionado si aplica). */
  epics?: { id: string; name: string; color: string; projectId: string }[]
}

type Props = Catalogs & {
  value: TaskFilters
  onChange: (next: TaskFilters) => void
  /** Controla qué filtros mostrar (todos por defecto). */
  show?: Partial<Record<keyof TaskFilters, boolean>>
  className?: string
  /** HU-2.3 — render del toggle "Solo ruta crítica" (solo aplica en Gantt). */
  showCriticalOnly?: boolean
}

const STATUS_OPTIONS = [
  { value: 'TODO', labelKey: 'task.status.todo' },
  { value: 'IN_PROGRESS', labelKey: 'task.status.inProgress' },
  { value: 'REVIEW', labelKey: 'task.status.review' },
  { value: 'DONE', labelKey: 'task.status.done' },
]

const TYPE_OPTIONS = [
  { value: 'AGILE_STORY', labelKey: 'task.type.agileStory' },
  { value: 'PMI_TASK', labelKey: 'task.type.pmiTask' },
  { value: 'ITIL_TICKET', labelKey: 'task.type.itilTicket' },
]

const PRIORITY_OPTIONS = [
  { value: 'LOW', labelKey: 'task.priority.low' },
  { value: 'MEDIUM', labelKey: 'task.priority.medium' },
  { value: 'HIGH', labelKey: 'task.priority.high' },
  { value: 'CRITICAL', labelKey: 'task.priority.critical' },
]

export function TaskFiltersBar({
  value,
  onChange,
  gerencias = [],
  areas = [],
  projects = [],
  users = [],
  epics = [],
  show,
  className,
  showCriticalOnly = false,
}: Props) {
  const { t } = useTranslation()
  const visible = (key: keyof TaskFilters) => show?.[key] !== false
  const active = countActiveFilters(value)

  const expanded = useUIStore((s) => s.filtersExpanded)
  const toggleExpanded = useUIStore((s) => s.toggleFiltersExpanded)
  const dateRangeOpen = useUIStore((s) => s.filtersDateRangeOpen)
  const toggleDateRange = useUIStore((s) => s.toggleFiltersDateRange)

  const criticalOnly = useUIStore((s) => s.criticalOnly)
  const toggleCriticalOnly = useUIStore((s) => s.toggleCriticalOnly)

  const visibleAreas = useMemo(() => {
    if (!value.gerenciaId) return areas
    return areas.filter((a) => a.gerenciaId === value.gerenciaId)
  }, [areas, value.gerenciaId])

  const visibleProjects = useMemo(() => {
    if (!value.areaId) return projects
    return projects.filter((p) => p.areaId === value.areaId)
  }, [projects, value.areaId])

  const set = <K extends keyof TaskFilters>(key: K, v: TaskFilters[K]) => {
    const next: TaskFilters = { ...value, [key]: v || undefined }
    if (key === 'gerenciaId') {
      if (v) {
        const areaOk = areas.find(
          (a) => a.id === next.areaId && a.gerenciaId === v,
        )
        if (!areaOk) next.areaId = undefined
        const projOk = projects.find((p) => p.id === next.projectId)
        const projArea = projOk
          ? areas.find((a) => a.id === projOk.areaId)
          : null
        if (projOk && projArea?.gerenciaId !== v) next.projectId = undefined
      }
    }
    if (key === 'areaId') {
      if (v) {
        const projOk = projects.find(
          (p) => p.id === next.projectId && p.areaId === v,
        )
        if (!projOk) next.projectId = undefined
      }
    }
    onChange(next)
  }

  const reset = () => onChange(EMPTY_TASK_FILTERS)

  // Chips de filtros activos para mostrar al pie cuando colapsado o como
  // resumen vivo. Cada chip permite removerse individualmente.
  type Chip = { key: keyof TaskFilters; label: string }
  const activeChips: Chip[] = []
  if (value.gerenciaId) {
    const g = gerencias.find((x) => x.id === value.gerenciaId)
    if (g) activeChips.push({ key: 'gerenciaId', label: `${t('filters.gerencia')}: ${g.name}` })
  }
  if (value.areaId) {
    const a = areas.find((x) => x.id === value.areaId)
    if (a) activeChips.push({ key: 'areaId', label: `${t('filters.area')}: ${a.name}` })
  }
  if (value.projectId) {
    const p = projects.find((x) => x.id === value.projectId)
    if (p) activeChips.push({ key: 'projectId', label: `${t('filters.project')}: ${p.name}` })
  }
  if (value.status) {
    const s = STATUS_OPTIONS.find((o) => o.value === value.status)
    activeChips.push({ key: 'status', label: `${t('filters.status')}: ${s ? t(s.labelKey) : value.status}` })
  }
  if (value.type) {
    const ty = TYPE_OPTIONS.find((o) => o.value === value.type)
    activeChips.push({ key: 'type', label: `${t('filters.type')}: ${ty ? t(ty.labelKey) : value.type}` })
  }
  if (value.priority) {
    const pr = PRIORITY_OPTIONS.find((o) => o.value === value.priority)
    activeChips.push({ key: 'priority', label: `${t('filters.priority')}: ${pr ? t(pr.labelKey) : value.priority}` })
  }
  if (value.assigneeId) {
    const u = value.assigneeId === UNASSIGNED_VALUE ? null : users.find((x) => x.id === value.assigneeId)
    activeChips.push({
      key: 'assigneeId',
      label: `${t('filters.assignee')}: ${value.assigneeId === UNASSIGNED_VALUE ? t('filters.unassigned') : (u?.name ?? value.assigneeId)}`,
    })
  }
  if (value.epicId) {
    const e = value.epicId === NO_EPIC_VALUE ? null : epics.find((x) => x.id === value.epicId)
    activeChips.push({ key: 'epicId', label: `${t('filters.epic')}: ${value.epicId === NO_EPIC_VALUE ? t('filters.noEpic') : (e?.name ?? value.epicId)}` })
  }
  if (value.dateFrom) activeChips.push({ key: 'dateFrom', label: `${t('filters.dateFrom')}: ${value.dateFrom}` })
  if (value.dateTo) activeChips.push({ key: 'dateTo', label: `${t('filters.dateTo')}: ${value.dateTo}` })

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring'
  const labelClass =
    'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5'

  return (
    <section
      data-testid="task-filters-bar"
      className={clsx(
        'rounded-xl border border-border bg-card mx-6 my-3 overflow-hidden',
        className,
      )}
    >
      {/* ── Header expand/collapse ─────────────────────────────────── */}
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
          <span className="text-sm font-semibold text-foreground">
            {t('filters.title')}
          </span>
          {active > 0 && (
            <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300">
              {active === 1
                ? t('filters.activeCountSingular', { count: active })
                : t('filters.activeCountPlural', { count: active })}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          {showCriticalOnly && (
            <button
              type="button"
              aria-pressed={criticalOnly}
              aria-label={
                criticalOnly
                  ? t('filters.criticalOnlyAriaPressed')
                  : t('filters.criticalOnlyAriaUnpressed')
              }
              onClick={() => toggleCriticalOnly()}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                criticalOnly
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-border bg-background text-foreground hover:bg-secondary',
              )}
            >
              <Zap className="h-3.5 w-3.5" />
              {criticalOnly
                ? t('filters.showingCritical')
                : t('filters.criticalOnly')}
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            disabled={active === 0}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors',
              active > 0
                ? 'text-foreground hover:bg-secondary'
                : 'text-muted-foreground/50 cursor-not-allowed',
            )}
          >
            <X className="h-3.5 w-3.5" />
            {t('buttons.clear')}
          </button>
          <button
            type="button"
            onClick={() => toggleExpanded(false)}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            {t('buttons.apply')}
          </button>
        </div>
      </header>

      {/* ── Body grid 4-col (visible solo si expanded) ─────────────── */}
      {expanded && (
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visible('gerenciaId') && gerencias.length > 0 && (
              <div>
                <label className={labelClass}>{t('filters.gerencia')}</label>
                <select
                  value={value.gerenciaId ?? ''}
                  onChange={(e) => set('gerenciaId', e.target.value)}
                  className={inputClass}
                  aria-label={t('filters.gerencia')}
                >
                  <option value="">{t('common.all')}</option>
                  {gerencias.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {visible('areaId') && areas.length > 0 && (
              <div>
                <label className={labelClass}>{t('filters.area')}</label>
                <select
                  value={value.areaId ?? ''}
                  onChange={(e) => set('areaId', e.target.value)}
                  className={inputClass}
                  aria-label={t('filters.area')}
                >
                  <option value="">{t('common.all')}</option>
                  {visibleAreas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {visible('projectId') && projects.length > 0 && (
              <div>
                <label className={labelClass}>{t('filters.project')}</label>
                <select
                  value={value.projectId ?? ''}
                  onChange={(e) => set('projectId', e.target.value)}
                  className={inputClass}
                  aria-label={t('filters.project')}
                >
                  <option value="">{t('common.all')}</option>
                  {visibleProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {visible('status') && (
              <div>
                <label className={labelClass}>{t('filters.status')}</label>
                <select
                  value={value.status ?? ''}
                  onChange={(e) => set('status', e.target.value)}
                  className={inputClass}
                  aria-label={t('filters.status')}
                >
                  <option value="">{t('common.all')}</option>
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {visible('type') && (
              <div>
                <label className={labelClass}>{t('filters.type')}</label>
                <select
                  value={value.type ?? ''}
                  onChange={(e) => set('type', e.target.value)}
                  className={inputClass}
                  aria-label={t('filters.type')}
                >
                  <option value="">{t('common.all')}</option>
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {visible('priority') && (
              <div>
                <label className={labelClass}>{t('filters.priority')}</label>
                <select
                  value={value.priority ?? ''}
                  onChange={(e) => set('priority', e.target.value)}
                  className={inputClass}
                  aria-label={t('filters.priority')}
                >
                  <option value="">{t('common.all')}</option>
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {visible('assigneeId') && users.length > 0 && (
              <div>
                <label className={labelClass}>{t('filters.assignee')}</label>
                <select
                  value={value.assigneeId ?? ''}
                  onChange={(e) => set('assigneeId', e.target.value)}
                  className={inputClass}
                  aria-label={t('filters.assignee')}
                >
                  <option value="">{t('common.all')}</option>
                  <option value={UNASSIGNED_VALUE}>
                    {t('filters.unassigned')}
                  </option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {visible('epicId') && epics.length > 0 && (
              <div>
                <label className={labelClass}>{t('filters.epic')}</label>
                <select
                  value={value.epicId ?? ''}
                  onChange={(e) => set('epicId', e.target.value)}
                  className={inputClass}
                  aria-label={t('filters.filterByEpic')}
                >
                  <option value="">{t('common.all')}</option>
                  <option value={NO_EPIC_VALUE}>{t('filters.noEpic')}</option>
                  {(value.projectId
                    ? epics.filter((ep) => ep.projectId === value.projectId)
                    : epics
                  ).map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* ── Sub-sección Rango de fechas (toggle independiente) ─── */}
          {(visible('dateFrom') || visible('dateTo')) && (
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
                {t('filters.dateRange')}
                {(value.dateFrom || value.dateTo) && (
                  <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">
                    {t('filters.dateRangeActive')}
                  </span>
                )}
              </button>
              {dateRangeOpen && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-6">
                  {visible('dateFrom') && (
                    <div>
                      <label className={labelClass}>
                        {t('filters.dateFrom')}
                      </label>
                      <input
                        type="date"
                        value={value.dateFrom ?? ''}
                        onChange={(e) => set('dateFrom', e.target.value)}
                        className={inputClass}
                        aria-label={t('filters.dateFrom')}
                        max={value.dateTo || undefined}
                      />
                    </div>
                  )}
                  {visible('dateTo') && (
                    <div>
                      <label className={labelClass}>
                        {t('filters.to')}
                      </label>
                      <input
                        type="date"
                        value={value.dateTo ?? ''}
                        onChange={(e) => set('dateTo', e.target.value)}
                        className={inputClass}
                        aria-label={t('filters.dateTo')}
                        min={value.dateFrom || undefined}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Chips activos al pie ───────────────────────────────────── */}
      {activeChips.length > 0 && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-muted/20 px-5 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('filters.activeChipsLabel')}
          </span>
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => set(c.key, undefined)}
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
