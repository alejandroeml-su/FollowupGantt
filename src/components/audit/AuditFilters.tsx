'use client'

/**
 * Ola P3 · Equipo P3-2 · Filtros del Audit Log.
 *
 * Wave P13 (Filters UX) — refactor con estructura estándar
 * expandible/colapsable + grid 4-col + chips activos + Limpiar/Aplicar.
 *
 * Filtros expuestos:
 *   - Actor (dropdown poblado con `getAuditActors`)
 *   - Entity (dropdown con `getAuditEntityTypes` + entityId opcional)
 *   - Action (dropdown con `KNOWN_AUDIT_ACTIONS`)
 *   - Rango de fechas (datetime-local from / to, sub-sección colapsable)
 */

import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Filter,
  Trash2,
  X,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  ACTION_LABELS,
  KNOWN_AUDIT_ACTIONS,
  type AuditAction,
} from '@/lib/audit/types'
import { useUIStore } from '@/lib/stores/ui'

export type AuditFiltersValue = {
  actorId: string
  entityType: string
  entityId: string
  action: AuditAction | ''
  from: string // datetime-local
  to: string
}

export const EMPTY_FILTERS: AuditFiltersValue = {
  actorId: '',
  entityType: '',
  entityId: '',
  action: '',
  from: '',
  to: '',
}

type Props = {
  value: AuditFiltersValue
  onChange: (next: AuditFiltersValue) => void
  onApply: () => void
  onReset: () => void
  onPurge: () => void
  isPending: boolean
  actors: { id: string; name: string; email: string }[]
  entityTypes: string[]
  canPurge: boolean
}

function countActive(v: AuditFiltersValue): number {
  let n = 0
  if (v.actorId) n++
  if (v.entityType) n++
  if (v.entityId) n++
  if (v.action) n++
  if (v.from) n++
  if (v.to) n++
  return n
}

export function AuditFilters({
  value,
  onChange,
  onApply,
  onReset,
  onPurge,
  isPending,
  actors,
  entityTypes,
  canPurge,
}: Props) {
  const expanded = useUIStore((s) => s.filtersExpanded)
  const toggleExpanded = useUIStore((s) => s.toggleFiltersExpanded)
  const dateRangeOpen = useUIStore((s) => s.filtersDateRangeOpen)
  const toggleDateRange = useUIStore((s) => s.toggleFiltersDateRange)

  const active = countActive(value)

  function setField<K extends keyof AuditFiltersValue>(
    key: K,
    val: AuditFiltersValue[K],
  ): void {
    onChange({ ...value, [key]: val })
  }

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring'
  const labelClass =
    'block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5'

  type Chip = { key: keyof AuditFiltersValue; label: string }
  const chips: Chip[] = []
  if (value.actorId) {
    const a = actors.find((x) => x.id === value.actorId)
    chips.push({ key: 'actorId', label: `Actor: ${a?.name ?? value.actorId}` })
  }
  if (value.entityType)
    chips.push({ key: 'entityType', label: `Entidad: ${value.entityType}` })
  if (value.entityId) chips.push({ key: 'entityId', label: `ID: ${value.entityId}` })
  if (value.action)
    chips.push({
      key: 'action',
      label: `Acción: ${ACTION_LABELS[value.action] ?? value.action}`,
    })
  if (value.from) chips.push({ key: 'from', label: `Desde: ${value.from}` })
  if (value.to) chips.push({ key: 'to', label: `Hasta: ${value.to}` })

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
          {active > 0 && (
            <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-300">
              {active} activo{active === 1 ? '' : 's'}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          {canPurge && (
            <button
              type="button"
              onClick={onPurge}
              disabled={isPending}
              title="Eliminar eventos de más de 90 días (retention policy)"
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Purgar (&gt;90d)
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            disabled={active === 0 || isPending}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors',
              active > 0 && !isPending
                ? 'text-foreground hover:bg-secondary'
                : 'text-muted-foreground/50 cursor-not-allowed',
            )}
          >
            <X className="h-3.5 w-3.5" />
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => {
              onApply()
              toggleExpanded(false)
            }}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      </header>

      {expanded && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onApply()
          }}
          className="px-5 py-4 space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelClass}>Actor</label>
              <select
                value={value.actorId}
                onChange={(e) => setField('actorId', e.target.value)}
                className={inputClass}
              >
                <option value="">Todos</option>
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Entidad</label>
              <select
                value={value.entityType}
                onChange={(e) => setField('entityType', e.target.value)}
                className={inputClass}
              >
                <option value="">Todas</option>
                {entityTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>ID de entidad</label>
              <input
                type="text"
                value={value.entityId}
                onChange={(e) => setField('entityId', e.target.value)}
                placeholder="(opcional)"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Acción</label>
              <select
                value={value.action}
                onChange={(e) =>
                  setField('action', e.target.value as AuditFiltersValue['action'])
                }
                className={inputClass}
              >
                <option value="">Todas</option>
                {KNOWN_AUDIT_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
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
              {(value.from || value.to) && (
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
                    type="datetime-local"
                    value={value.from}
                    onChange={(e) => setField('from', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>hasta</label>
                  <input
                    type="datetime-local"
                    value={value.to}
                    onChange={(e) => setField('to', e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </div>
        </form>
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
              onClick={() => setField(c.key, '' as AuditFiltersValue[typeof c.key])}
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
