'use client'

/**
 * US-7.5 · Proofing (R4) — Panel lateral con la lista de anotaciones.
 *
 * Responsabilidades:
 *   - Filtros por status (All / Open / Resolved / Changes Requested).
 *   - Render plano de threads (raíz + replies nested).
 *   - Acciones: marcar como Resolved / Reopen / Pedir cambios / Reply / Delete.
 *   - Click en una row → notifica al canvas para seleccionar el marker.
 *
 * Diseño:
 *   - Sortable por createdAt asc (consistente con la numeración del canvas).
 *   - Estado local controla qué thread tiene el editor de reply abierto.
 *   - Si se reciben loading/error externos, los renderiza pero NO los
 *     gestiona — el contenedor (ProofingModal) maneja el ciclo.
 */

import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  RotateCcw,
  Trash2,
  CornerDownRight,
  MessageSquare,
} from 'lucide-react'
import type { ProofingAnnotationDTO } from '@/lib/actions/proofing'

export type AnnotationListFilter =
  | 'ALL'
  | 'OPEN'
  | 'RESOLVED'
  | 'CHANGES_REQUESTED'

export interface AnnotationListProps {
  annotations: ProofingAnnotationDTO[]
  filter: AnnotationListFilter
  onFilterChange: (filter: AnnotationListFilter) => void
  selectedAnnotationId?: string | null
  onSelectAnnotation?: (id: string) => void
  onUpdateStatus: (
    id: string,
    status: 'OPEN' | 'RESOLVED' | 'CHANGES_REQUESTED',
  ) => Promise<void>
  onReply: (parentId: string, text: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const FILTER_LABELS: Record<AnnotationListFilter, string> = {
  ALL: 'Todas',
  OPEN: 'Abiertas',
  RESOLVED: 'Resueltas',
  CHANGES_REQUESTED: 'Cambios',
}

function StatusBadge({
  status,
}: {
  status: ProofingAnnotationDTO['status']
}) {
  const Icon =
    status === 'RESOLVED'
      ? CheckCircle2
      : status === 'CHANGES_REQUESTED'
        ? AlertTriangle
        : Circle
  const label =
    status === 'RESOLVED'
      ? 'Resuelta'
      : status === 'CHANGES_REQUESTED'
        ? 'Cambios solicitados'
        : 'Abierta'
  const color =
    status === 'RESOLVED'
      ? 'text-green-600 dark:text-green-400'
      : status === 'CHANGES_REQUESTED'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-blue-600 dark:text-blue-400'
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}
      data-testid="annotation-status-badge"
      data-status={status}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
}

/**
 * Agrupa anotaciones por threadId (raíz). Cada bucket queda ordenado por
 * createdAt asc para que reply 1, reply 2… aparezcan en orden cronológico.
 */
function groupByThread(annotations: ProofingAnnotationDTO[]): Array<{
  root: ProofingAnnotationDTO
  replies: ProofingAnnotationDTO[]
}> {
  const sorted = [...annotations].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )
  const roots = sorted.filter((a) => a.parentAnnotationId === null)
  return roots.map((root) => ({
    root,
    replies: sorted.filter((a) => a.parentAnnotationId === root.id),
  }))
}

function applyFilter(
  list: ProofingAnnotationDTO[],
  filter: AnnotationListFilter,
): ProofingAnnotationDTO[] {
  if (filter === 'ALL') return list
  // El filtro aplica al thread raíz; replies vienen junto con su root.
  const filteredRoots = list.filter(
    (a) => a.parentAnnotationId === null && a.status === filter,
  )
  const rootIds = new Set(filteredRoots.map((r) => r.id))
  const replies = list.filter(
    (a) => a.parentAnnotationId && rootIds.has(a.parentAnnotationId),
  )
  return [...filteredRoots, ...replies]
}

export function AnnotationList({
  annotations,
  filter,
  onFilterChange,
  selectedAnnotationId = null,
  onSelectAnnotation,
  onUpdateStatus,
  onReply,
  onDelete,
}: AnnotationListProps) {
  const [replyingId, setReplyingId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)

  const filtered = useMemo(
    () => applyFilter(annotations, filter),
    [annotations, filter],
  )
  const threads = useMemo(() => groupByThread(filtered), [filtered])

  // Numeración estable según orden global de raíces creadas.
  const rootIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    const allRoots = [...annotations]
      .filter((a) => a.parentAnnotationId === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    allRoots.forEach((r, i) => map.set(r.id, i + 1))
    return map
  }, [annotations])

  const counts = useMemo(() => {
    const onlyRoots = annotations.filter((a) => a.parentAnnotationId === null)
    return {
      ALL: onlyRoots.length,
      OPEN: onlyRoots.filter((a) => a.status === 'OPEN').length,
      RESOLVED: onlyRoots.filter((a) => a.status === 'RESOLVED').length,
      CHANGES_REQUESTED: onlyRoots.filter(
        (a) => a.status === 'CHANGES_REQUESTED',
      ).length,
    } satisfies Record<AnnotationListFilter, number>
  }, [annotations])

  async function handleReplySubmit(parentId: string) {
    const text = replyText.trim()
    if (!text) return
    setSubmittingReply(true)
    try {
      await onReply(parentId, text)
      setReplyText('')
      setReplyingId(null)
    } catch (err) {
      // Errores se notifican vía toast/state del contenedor; aquí dejamos
      // la UI abierta para que el usuario reintente.
      console.warn(
        '[AnnotationList] reply failed',
        err instanceof Error ? err.message : err,
      )
    } finally {
      setSubmittingReply(false)
    }
  }

  return (
    <section
      data-testid="annotation-list"
      aria-labelledby="annotation-list-heading"
      className="flex h-full flex-col"
    >
      <header className="border-b border-border px-3 py-2">
        <h3
          id="annotation-list-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
          Comentarios
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {counts.ALL}
          </span>
        </h3>
        <div
          role="tablist"
          aria-label="Filtro de estado"
          className="mt-2 flex flex-wrap gap-1"
        >
          {(
            ['ALL', 'OPEN', 'CHANGES_REQUESTED', 'RESOLVED'] as AnnotationListFilter[]
          ).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              data-testid={`annotation-filter-${f}`}
              onClick={() => onFilterChange(f)}
              className={`rounded border px-2 py-0.5 text-xs ${
                filter === f
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              {FILTER_LABELS[f]} ({counts[f]})
            </button>
          ))}
        </div>
      </header>

      <ol
        role="list"
        className="flex-1 space-y-2 overflow-y-auto px-3 py-2"
        data-testid="annotation-list-items"
      >
        {threads.length === 0 ? (
          <li className="py-8 text-center text-xs text-muted-foreground">
            {annotations.length === 0
              ? 'Sin comentarios. Click sobre el archivo para agregar uno.'
              : 'Sin coincidencias para este filtro.'}
          </li>
        ) : (
          threads.map(({ root, replies }) => {
            const idx = rootIndexMap.get(root.id) ?? 0
            const selected = root.id === selectedAnnotationId
            return (
              <li
                key={root.id}
                data-testid="annotation-thread"
                data-annotation-id={root.id}
                data-selected={selected}
                className={`rounded border p-2 ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card/40'
                }`}
                onClick={() => onSelectAnnotation?.(root.id)}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
                    aria-label={`Marker ${idx}`}
                  >
                    {idx}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {root.authorName ?? 'Anónimo'}
                      </span>
                      <StatusBadge status={root.status} />
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                      {root.text}
                    </p>
                    {replies.length > 0 ? (
                      <ul className="mt-2 space-y-1 border-l-2 border-border pl-2">
                        {replies.map((r) => (
                          <li
                            key={r.id}
                            data-testid="annotation-reply"
                            data-annotation-id={r.id}
                            className="text-xs"
                          >
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <CornerDownRight
                                className="h-3 w-3"
                                aria-hidden
                              />
                              <span className="font-medium text-foreground">
                                {r.authorName ?? 'Anónimo'}
                              </span>
                            </span>
                            <p className="ml-4 mt-0.5 whitespace-pre-wrap break-words">
                              {r.text}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {replyingId === root.id ? (
                      <div
                        className="mt-2 space-y-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <textarea
                          data-testid={`annotation-reply-input-${root.id}`}
                          autoFocus
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Escribe tu respuesta…"
                          disabled={submittingReply}
                          className="h-16 w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setReplyingId(null)
                              setReplyText('')
                            }}
                            disabled={submittingReply}
                            className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            data-testid={`annotation-reply-submit-${root.id}`}
                            onClick={() => handleReplySubmit(root.id)}
                            disabled={
                              submittingReply || replyText.trim().length === 0
                            }
                            className="rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            {submittingReply ? 'Enviando…' : 'Responder'}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div
                      className="mt-2 flex flex-wrap gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingId(root.id)
                          setReplyText('')
                        }}
                        className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                        data-testid={`annotation-action-reply-${root.id}`}
                      >
                        <CornerDownRight className="h-3 w-3" aria-hidden />
                        Responder
                      </button>
                      {root.status !== 'RESOLVED' ? (
                        <button
                          type="button"
                          onClick={() => onUpdateStatus(root.id, 'RESOLVED')}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                          data-testid={`annotation-action-resolve-${root.id}`}
                        >
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          Resolver
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onUpdateStatus(root.id, 'OPEN')}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                          data-testid={`annotation-action-reopen-${root.id}`}
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden />
                          Reabrir
                        </button>
                      )}
                      {root.status !== 'CHANGES_REQUESTED' ? (
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateStatus(root.id, 'CHANGES_REQUESTED')
                          }
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                          data-testid={`annotation-action-changes-${root.id}`}
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          Pedir cambios
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            typeof window === 'undefined' ||
                            window.confirm('¿Eliminar este comentario?')
                          ) {
                            void onDelete(root.id)
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10"
                        data-testid={`annotation-action-delete-${root.id}`}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            )
          })
        )}
      </ol>
    </section>
  )
}
