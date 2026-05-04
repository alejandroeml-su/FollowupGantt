'use client'

/**
 * Ola P3 · Equipo P3-2 · Cliente de la página `/audit-log`.
 *
 * Renderiza filtros + tabla paginada de eventos. Carga inicial viene del
 * server component padre (SSR + cache); subsiguientes "cargar más" y
 * cambios de filtros hacen round-trip al server action `queryAuditEvents`.
 *
 * Diseño UI:
 *   - Tabla densa con columnas Fecha · Actor · Acción · Entidad · IP.
 *   - Click en una fila abre un drawer lateral con el detalle JSON
 *     (`before`/`after`/`metadata`) en formato expandible.
 *   - Empty state amigable cuando no hay eventos / filtros sin matches.
 */

import { useMemo, useState, useTransition } from 'react'
import { ShieldCheck, ChevronDown, ChevronRight, X, Trash2 } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { clsx } from 'clsx'
import {
  queryAuditEvents,
  purgeOldAuditEvents,
} from '@/lib/actions/audit'
import {
  ACTION_LABELS,
  type AuditAction,
  type SerializedAuditEvent,
} from '@/lib/audit/types'
import { AuditFilters, EMPTY_FILTERS, type AuditFiltersValue } from './AuditFilters'

type Props = {
  initialItems: SerializedAuditEvent[]
  initialNextCursor: string | null
  actors: { id: string; name: string; email: string }[]
  entityTypes: string[]
  /**
   * El guard de roles vive en el server (página); aquí solo recibimos un
   * boolean para mostrar/ocultar acciones destructivas (purge).
   */
  canPurge: boolean
}

function actionLabel(action: string): string {
  if (action in ACTION_LABELS) {
    return ACTION_LABELS[action as AuditAction]
  }
  return action
}

function formatAbsolute(iso: string): string {
  try {
    return format(new Date(iso), "d 'de' MMM yyyy · HH:mm:ss", { locale: es })
  } catch {
    return iso
  }
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es })
  } catch {
    return iso
  }
}

/**
 * Convierte un AuditFiltersValue (UI strings) en el shape que espera el
 * server action `queryAuditEvents`. Trata strings vacías como "sin filtro".
 */
function toQueryInput(f: AuditFiltersValue): {
  actorId?: string | null
  entityType?: string | null
  entityId?: string | null
  action?: AuditAction | null
  from?: string | null
  to?: string | null
} {
  return {
    actorId: f.actorId || null,
    entityType: f.entityType || null,
    entityId: f.entityId || null,
    action: f.action || null,
    // datetime-local emite "YYYY-MM-DDTHH:mm" sin segundos ni TZ.
    // Lo casteamos a ISO local y luego a Date → ISO UTC.
    from: f.from ? new Date(f.from).toISOString() : null,
    to: f.to ? new Date(f.to).toISOString() : null,
  }
}

export function AuditLogClient({
  initialItems,
  initialNextCursor,
  actors,
  entityTypes,
  canPurge,
}: Props) {
  const [filters, setFilters] = useState<AuditFiltersValue>(EMPTY_FILTERS)
  const [items, setItems] = useState<SerializedAuditEvent[]>(initialItems)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [purgePreview, setPurgePreview] = useState<{
    count: number
    cutoffIso: string
  } | null>(null)

  const hasResults = items.length > 0

  function applyFilters(): void {
    setError(null)
    setExpanded(null)
    startTransition(async () => {
      try {
        const res = await queryAuditEvents({
          ...toQueryInput(filters),
          limit: 50,
        })
        setItems(res.items)
        setNextCursor(res.nextCursor)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al consultar eventos')
      }
    })
  }

  function resetFilters(): void {
    setFilters(EMPTY_FILTERS)
    setError(null)
    setExpanded(null)
    startTransition(async () => {
      try {
        const res = await queryAuditEvents({ limit: 50 })
        setItems(res.items)
        setNextCursor(res.nextCursor)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al consultar eventos')
      }
    })
  }

  function loadMore(): void {
    if (!nextCursor) return
    startTransition(async () => {
      try {
        const res = await queryAuditEvents({
          ...toQueryInput(filters),
          limit: 50,
          cursorId: nextCursor,
        })
        setItems((prev) => [...prev, ...res.items])
        setNextCursor(res.nextCursor)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar más eventos')
      }
    })
  }

  /**
   * Flujo de purge: primero dry-run para mostrar count → si confirma,
   * ejecuta el real. Mantenemos toda la coreografía en cliente para
   * evitar un modal-server.
   */
  function handlePurgeRequest(): void {
    setError(null)
    startTransition(async () => {
      try {
        const preview = await purgeOldAuditEvents({ dryRun: true })
        setPurgePreview({ count: preview.count, cutoffIso: preview.cutoffIso })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al estimar purge')
      }
    })
  }

  function handlePurgeConfirm(): void {
    startTransition(async () => {
      try {
        const res = await purgeOldAuditEvents({ dryRun: false })
        setPurgePreview(null)
        // Refresca el listado tras purge.
        const refresh = await queryAuditEvents({
          ...toQueryInput(filters),
          limit: 50,
        })
        setItems(refresh.items)
        setNextCursor(refresh.nextCursor)
        setError(`Purga completada: ${res.count} eventos eliminados`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al ejecutar purge')
      }
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border bg-card px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Auditoría</h1>
            <p className="text-[12px] text-muted-foreground">
              {items.length} eventos · retention 90 días
            </p>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 sm:p-6">
        <AuditFilters
          value={filters}
          onChange={setFilters}
          onApply={applyFilters}
          onReset={resetFilters}
          onPurge={handlePurgeRequest}
          isPending={isPending}
          actors={actors}
          entityTypes={entityTypes}
          canPurge={canPurge}
        />

        {/* Error / status banner */}
        {error && (
          <div
            role="status"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}

        {/* Purge confirm modal */}
        {purgePreview && (
          <PurgeConfirmDialog
            count={purgePreview.count}
            cutoffIso={purgePreview.cutoffIso}
            isPending={isPending}
            onConfirm={handlePurgeConfirm}
            onCancel={() => setPurgePreview(null)}
          />
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card/40 custom-scrollbar">
          {hasResults ? (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-6 px-3 py-2"></th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Acción</th>
                  <th className="px-3 py-2">Entidad</th>
                  <th className="px-3 py-2">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((ev) => {
                  const isOpen = expanded === ev.id
                  return (
                    <EventRow
                      key={ev.id}
                      event={ev}
                      isOpen={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : ev.id)}
                    />
                  )
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState isPending={isPending} />
          )}
        </div>

        {/* Pagination */}
        {nextCursor && (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={isPending}
              className="rounded-md border border-border bg-background px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Cargando…' : 'Cargar más'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── Subcomponentes ─────────────────────────

function EventRow({
  event,
  isOpen,
  onToggle,
}: {
  event: SerializedAuditEvent
  isOpen: boolean
  onToggle: () => void
}) {
  const Chevron = isOpen ? ChevronDown : ChevronRight
  return (
    <>
      <tr
        className={clsx(
          'cursor-pointer transition-colors hover:bg-accent/40',
          isOpen && 'bg-accent/40',
        )}
        onClick={onToggle}
        data-testid="audit-row"
      >
        <td className="px-3 py-2 text-muted-foreground">
          <Chevron className="h-3.5 w-3.5" aria-hidden="true" />
        </td>
        <td className="px-3 py-2 align-top">
          <div className="text-foreground">{formatAbsolute(event.createdAt)}</div>
          <div className="text-[10px] text-muted-foreground">
            {formatRelative(event.createdAt)}
          </div>
        </td>
        <td className="px-3 py-2 align-top">
          {event.actorName ? (
            <>
              <div className="font-medium text-foreground">{event.actorName}</div>
              {event.actorEmail && (
                <div className="text-[10px] text-muted-foreground">
                  {event.actorEmail}
                </div>
              )}
            </>
          ) : (
            <span className="text-muted-foreground italic">(sistema)</span>
          )}
        </td>
        <td className="px-3 py-2 align-top">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            {actionLabel(event.action)}
          </span>
        </td>
        <td className="px-3 py-2 align-top">
          <div className="font-medium text-foreground">{event.entityType}</div>
          {event.entityId && (
            <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[160px]">
              {event.entityId}
            </div>
          )}
        </td>
        <td className="px-3 py-2 align-top font-mono text-[11px] text-muted-foreground">
          {event.ipAddress ?? '—'}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-muted/20">
          <td colSpan={6} className="px-6 py-3">
            <DetailPanel event={event} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetailPanel({ event }: { event: SerializedAuditEvent }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <JsonBlock label="Antes" value={event.before} />
      <JsonBlock label="Después" value={event.after} />
      <JsonBlock label="Metadata" value={event.metadata} />
      {event.userAgent && (
        <div className="lg:col-span-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            User-Agent
          </span>
          <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
            {event.userAgent}
          </p>
        </div>
      )}
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const pretty = useMemo(() => {
    if (value === null || value === undefined) return null
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }, [value])

  return (
    <div className="rounded-md border border-border bg-background/60 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {pretty ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">
          {pretty}
        </pre>
      ) : (
        <p className="text-[11px] italic text-muted-foreground">(vacío)</p>
      )}
    </div>
  )
}

function EmptyState({ isPending }: { isPending: boolean }) {
  return (
    <div className="flex h-64 items-center justify-center px-6 text-center">
      <div>
        <ShieldCheck
          className="mx-auto h-10 w-10 text-muted-foreground/40"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-medium text-foreground">
          {isPending ? 'Buscando eventos…' : 'Sin eventos para los filtros actuales'}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Los eventos críticos del sistema aparecerán aquí en cuanto ocurran.
        </p>
      </div>
    </div>
  )
}

function PurgeConfirmDialog({
  count,
  cutoffIso,
  isPending,
  onConfirm,
  onCancel,
}: {
  count: number
  cutoffIso: string
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Confirmar purga de eventos antiguos
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="text-xs text-foreground">
        Se eliminarán <strong>{count}</strong> eventos con fecha anterior a{' '}
        <strong>{formatAbsolute(cutoffIso)}</strong>. Esta operación es
        irreversible.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending || count === 0}
          className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Purgando…' : 'Confirmar purga'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
