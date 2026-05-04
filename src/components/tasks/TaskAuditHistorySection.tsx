'use client'

/**
 * Equipo D2 · Sección de Auditoría dentro del TaskDrawer.
 *
 * Lista los últimos N eventos del entityType `task` para `task.id`.
 * Diseñada como collapsible: por defecto colapsada para no saturar el
 * drawer. Click en una fila expande el JSON `before/after` para usuarios
 * curiosos (admin / debugging).
 *
 * Decisiones (D2-AH-1..3):
 *   D2-AH-1: Carga lazy on-mount cuando el panel se abre por primera vez.
 *            Mientras esté colapsado no consumimos cuota de queries.
 *   D2-AH-2: Empty state amistoso si no hay eventos — explícitamente NO
 *            ocultamos el header para que el usuario sepa que la sección
 *            existe (y la pueda volver a abrir tras una acción).
 *   D2-AH-3: El JSON before/after se renderiza con `<details>` nativo
 *            (sin librería) y `JSON.stringify(..., 2)` con cap a 5KB para
 *            evitar reventar el DOM en eventos con snapshots grandes.
 */

import { useEffect, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, History as HistoryIcon } from 'lucide-react'
import {
  queryAuditEvents,
  type QueryAuditEventsInput,
} from '@/lib/actions/audit'
import {
  ACTION_LABELS,
  type AuditAction,
  type SerializedAuditEvent,
} from '@/lib/audit/types'

interface Props {
  taskId: string
  /** Carga inicial. Si true (test/RSC), no hacemos fetch. */
  preloadedEvents?: SerializedAuditEvent[]
  /** Default número de eventos a pedir. */
  limit?: number
  /** Sección abierta por defecto. */
  defaultOpen?: boolean
}

const SNAPSHOT_LIMIT_BYTES = 5_000

function actionLabel(action: string): string {
  return action in ACTION_LABELS
    ? ACTION_LABELS[action as AuditAction]
    : action
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function summarize(event: SerializedAuditEvent): string {
  if (event.metadata && typeof event.metadata === 'object') {
    const m = event.metadata as Record<string, unknown>
    if (typeof m.summary === 'string') return m.summary
  }
  if (event.entityId) return `#${event.entityId.substring(0, 8)}`
  return ''
}

function clampJson(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2)
    if (!json) return '—'
    if (json.length > SNAPSHOT_LIMIT_BYTES) {
      return `${json.slice(0, SNAPSHOT_LIMIT_BYTES)}…\n/* truncado, ${json.length} bytes */`
    }
    return json
  } catch {
    return '/* no serializable */'
  }
}

export function TaskAuditHistorySection({
  taskId,
  preloadedEvents,
  limit = 10,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState<boolean>(defaultOpen)
  const [events, setEvents] = useState<SerializedAuditEvent[]>(
    preloadedEvents ?? [],
  )
  const [loaded, setLoaded] = useState<boolean>(!!preloadedEvents)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    void (async () => {
      try {
        const filters: QueryAuditEventsInput = {
          entityType: 'task',
          entityId: taskId,
          limit,
        }
        const res = await queryAuditEvents(filters)
        if (cancelled) return
        startTransition(() => {
          setEvents(res.items)
          setLoaded(true)
        })
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Error cargando auditoría'
        setError(msg)
        setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, loaded, taskId, limit])

  return (
    <section
      aria-labelledby="task-audit-heading"
      className="pt-2"
      data-testid="task-audit-section"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="task-audit-body"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 border-b border-border pb-2 text-left text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span
          id="task-audit-heading"
          className="flex items-center gap-2"
        >
          <HistoryIcon className="h-4 w-4 text-indigo-400" /> Auditoría
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden />
        )}
      </button>

      {open && (
        <div
          id="task-audit-body"
          className="pt-3"
          data-testid="task-audit-body"
        >
          {!loaded && (
            <p className="text-xs text-muted-foreground" data-testid="task-audit-loading">
              Cargando eventos…
            </p>
          )}
          {loaded && error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {loaded && !error && events.length === 0 && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="task-audit-empty"
            >
              Aún no hay eventos registrados para esta tarea.
            </p>
          )}
          {loaded && !error && events.length > 0 && (
            <ul className="space-y-2" data-testid="task-audit-list">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="rounded-md border border-border bg-card/40 px-3 py-2 text-xs"
                  data-testid={`task-audit-row-${e.id}`}
                >
                  <details>
                    <summary className="flex cursor-pointer items-center justify-between gap-3 text-foreground/90">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {actionLabel(e.action)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDate(e.createdAt)} ·{' '}
                          {e.actorName ?? e.actorEmail ?? 'Sistema'}
                          {summarize(e) && ` · ${summarize(e)}`}
                        </span>
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {e.action}
                      </span>
                    </summary>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Antes
                        </p>
                        <pre className="max-h-40 overflow-auto rounded bg-subtle/40 p-2 text-[10px] leading-tight text-foreground/80">
                          {clampJson(e.before)}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Después
                        </p>
                        <pre className="max-h-40 overflow-auto rounded bg-subtle/40 p-2 text-[10px] leading-tight text-foreground/80">
                          {clampJson(e.after)}
                        </pre>
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export default TaskAuditHistorySection
