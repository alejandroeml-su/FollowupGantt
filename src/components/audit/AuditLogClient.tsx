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
import { es, enUS } from 'date-fns/locale'
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
import { useTranslation } from '@/lib/i18n/use-translation'

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

function formatAbsolute(iso: string, locale: 'es' | 'en' = 'es'): string {
  try {
    const dateLocale = locale === 'en' ? enUS : es
    const pattern = locale === 'en' ? "MMM d, yyyy · HH:mm:ss" : "d 'de' MMM yyyy · HH:mm:ss"
    return format(new Date(iso), pattern, { locale: dateLocale })
  } catch {
    return iso
  }
}

function formatRelative(iso: string, locale: 'es' | 'en' = 'es'): string {
  try {
    const dateLocale = locale === 'en' ? enUS : es
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: dateLocale })
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
  const { t, locale } = useTranslation()
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
        setError(err instanceof Error ? err.message : t('pages.audit.errorQuery'))
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
        setError(err instanceof Error ? err.message : t('pages.audit.errorQuery'))
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
        setError(err instanceof Error ? err.message : t('pages.audit.errorLoadMore'))
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
        setError(err instanceof Error ? err.message : t('pages.audit.errorPurgeEstimate'))
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
        setError(t('pages.audit.purgeDone', { count: res.count }))
      } catch (err) {
        setError(err instanceof Error ? err.message : t('pages.audit.errorPurgeExecute'))
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
            <h1 className="text-lg font-semibold text-foreground">{t('pages.audit.headerTitle')}</h1>
            <p className="text-[12px] text-muted-foreground">
              {t('pages.audit.headerSubtitle', { count: items.length })}
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
            locale={locale}
          />
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-card/40 custom-scrollbar">
          {hasResults ? (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-6 px-3 py-2"></th>
                  <th className="px-3 py-2">{t('pages.audit.colDate')}</th>
                  <th className="px-3 py-2">{t('pages.audit.colActor')}</th>
                  <th className="px-3 py-2">{t('pages.audit.colAction')}</th>
                  <th className="px-3 py-2">{t('pages.audit.colEntity')}</th>
                  <th className="px-3 py-2">{t('pages.audit.colIp')}</th>
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
                      locale={locale}
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
              {isPending ? t('buttons.loading') : t('buttons.loadMore')}
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
  locale,
}: {
  event: SerializedAuditEvent
  isOpen: boolean
  onToggle: () => void
  locale: 'es' | 'en'
}) {
  const { t } = useTranslation()
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
          <div className="text-foreground">{formatAbsolute(event.createdAt, locale)}</div>
          <div className="text-[10px] text-muted-foreground">
            {formatRelative(event.createdAt, locale)}
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
            <span className="text-muted-foreground italic">{t('common.system')}</span>
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
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <JsonBlock label={t('pages.audit.detailBefore')} value={event.before} />
      <JsonBlock label={t('pages.audit.detailAfter')} value={event.after} />
      <JsonBlock label={t('pages.audit.detailMetadata')} value={event.metadata} />
      {event.userAgent && (
        <div className="lg:col-span-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('pages.audit.detailUserAgent')}
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
  const { t } = useTranslation()
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
        <p className="text-[11px] italic text-muted-foreground">{t('pages.audit.detailEmpty')}</p>
      )}
    </div>
  )
}

function EmptyState({ isPending }: { isPending: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-64 items-center justify-center px-6 text-center">
      <div>
        <ShieldCheck
          className="mx-auto h-10 w-10 text-muted-foreground/40"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-medium text-foreground">
          {isPending ? t('pages.audit.emptySearching') : t('pages.audit.emptyTitle')}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t('pages.audit.emptyHint')}
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
  locale,
}: {
  count: number
  cutoffIso: string
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
  locale: 'es' | 'en'
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {t('pages.audit.purgeTitle')}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label={t('buttons.cancel')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="text-xs text-foreground">
        {t('pages.audit.purgeBody', { count, date: formatAbsolute(cutoffIso, locale) })}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending || count === 0}
          className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? t('buttons.purging') : t('pages.audit.purgeConfirm')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          {t('buttons.cancel')}
        </button>
      </div>
    </div>
  )
}
