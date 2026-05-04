'use client'

/**
 * Ola P3 · Equipo P3-2 · Filtros del Audit Log.
 *
 * Componente controlado: recibe los filtros actuales + setters y emite
 * cambios al padre. El padre (`AuditLogClient`) decide cuándo dispara la
 * query (debounce / botón explícito).
 *
 * Filtros expuestos:
 *   - Actor (dropdown poblado con `getAuditActors`)
 *   - Entity (dropdown con `getAuditEntityTypes` + entityId opcional)
 *   - Action (dropdown con `KNOWN_AUDIT_ACTIONS`)
 *   - Rango de fechas (from / to, ISO local)
 */

import { Filter, RotateCcw, Trash2 } from 'lucide-react'
import { ACTION_LABELS, KNOWN_AUDIT_ACTIONS, type AuditAction } from '@/lib/audit/types'

export type AuditFiltersValue = {
  actorId: string
  entityType: string
  entityId: string
  action: AuditAction | ''
  from: string // datetime-local string ('' si vacío)
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
  function setField<K extends keyof AuditFiltersValue>(
    key: K,
    val: AuditFiltersValue[K],
  ): void {
    onChange({ ...value, [key]: val })
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Filter className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Filtros</h2>
      </div>

      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          onApply()
        }}
      >
        {/* Actor */}
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Actor</span>
          <select
            value={value.actorId}
            onChange={(e) => setField('actorId', e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">Todos</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        {/* Entity type */}
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Entidad</span>
          <select
            value={value.entityType}
            onChange={(e) => setField('entityType', e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">Todas</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {/* Entity id */}
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">ID de entidad</span>
          <input
            type="text"
            value={value.entityId}
            onChange={(e) => setField('entityId', e.target.value)}
            placeholder="(opcional)"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </label>

        {/* Action */}
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Acción</span>
          <select
            value={value.action}
            onChange={(e) =>
              setField('action', e.target.value as AuditFiltersValue['action'])
            }
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="">Todas</option>
            {KNOWN_AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]} ({a})
              </option>
            ))}
          </select>
        </label>

        {/* Date range */}
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Desde</span>
          <input
            type="datetime-local"
            value={value.from}
            onChange={(e) => setField('from', e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Hasta</span>
          <input
            type="datetime-local"
            value={value.to}
            onChange={(e) => setField('to', e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </label>

        {/* Action buttons (full row) */}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Limpiar
          </button>

          {canPurge && (
            <button
              type="button"
              onClick={onPurge}
              disabled={isPending}
              title="Eliminar eventos de más de 90 días (retention policy)"
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Purgar antiguos (&gt;90d)
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
