'use client'

/**
 * Wave R5-Extended · CMDB avanzado · pestaña "Cambios" en /cmdb/[ciId].
 *
 * UI ligera (no es un workflow ITIL formal completo):
 *   - Botón "Solicitar cambio" → abre modal con `title`, `rationale`,
 *     `plannedAt`. Cualquiera con visibility del workspace puede.
 *   - Tabla de Change Requests con su status badge + acciones según rol.
 *     - PROPOSED: el solicitante (o un ADMIN) puede CANCELAR.
 *                 ADMIN: APROBAR.
 *     - APPROVED: ADMIN puede EJECUTAR o CANCELAR.
 *     - REJECTED / CANCELLED / EXECUTED: terminal.
 *
 * Los botones disparan los server actions directamente vía `useTransition`.
 * Si una mutación falla con `[CODE]`, mostramos el mensaje del Error
 * (pattern matching de errores tipados — convención del repo).
 */

import { useState, useTransition } from 'react'
import { Plus, Loader2, X, Check, PlayCircle, Ban } from 'lucide-react'
import { clsx } from 'clsx'
import {
  createCIChangeRequest,
  approveCIChangeRequest,
  executeCIChangeRequest,
  cancelCIChangeRequest,
} from '@/lib/actions/cmdb'

type Status = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'CANCELLED'

export type CIChangeRequestRow = {
  id: string
  title: string
  rationale: string | null
  plannedAt: string | null
  executedAt: string | null
  status: Status
  createdAt: string
  requestedBy: { id: string; name: string }
  approvedBy: { id: string; name: string } | null
}

const STATUS_LABEL: Record<Status, string> = {
  PROPOSED: 'Propuesto',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  EXECUTED: 'Ejecutado',
  CANCELLED: 'Cancelado',
}

const STATUS_BADGE: Record<Status, string> = {
  PROPOSED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  EXECUTED: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  CANCELLED: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}

type Props = {
  ciId: string
  /** ID del usuario en sesión — para saber si es el solicitante. */
  currentUserId: string
  /** Si el usuario tiene rol ADMIN — gobierna acciones de aprobar/ejecutar. */
  isAdmin: boolean
  initialRows: CIChangeRequestRow[]
}

export function CIChangeRequestsClient({
  ciId,
  currentUserId,
  isAdmin,
  initialRows,
}: Props) {
  const [rows, setRows] = useState<CIChangeRequestRow[]>(initialRows)
  const [openCreate, setOpenCreate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /**
   * Optimistic-ish refresh: el server action ya hizo `revalidatePath`,
   * pero la página padre es server component así que para que se
   * refleje sin recargar, sustituimos local. Si quisiéramos refresh
   * real podemos hacer `router.refresh()` — para esta UX simple es
   * suficiente patch local.
   */
  function patchRow(id: string, patch: Partial<CIChangeRequestRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function runAction(fn: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await fn()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado')
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Cambios ({rows.length})
        </h2>
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-subtle disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> Solicitar cambio
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
        >
          {error}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-subtle/40 p-3 text-xs text-muted-foreground">
          No hay cambios registrados para este CI.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-subtle/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">
                  Título
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">
                  Solicitante
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">
                  Planeado
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">
                  Ejecutado
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const isOwner = r.requestedBy.id === currentUserId
                const canCancel =
                  (isOwner || isAdmin) &&
                  r.status !== 'EXECUTED' &&
                  r.status !== 'CANCELLED' &&
                  r.status !== 'REJECTED'
                const canApprove = isAdmin && r.status === 'PROPOSED'
                const canExecute = isAdmin && r.status === 'APPROVED'

                return (
                  <tr key={r.id} className="bg-card">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-foreground">
                        {r.title}
                      </div>
                      {r.rationale ? (
                        <div className="mt-0.5 line-clamp-2 text-muted-foreground">
                          {r.rationale}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={clsx(
                          'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                          STATUS_BADGE[r.status],
                        )}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-foreground">
                      {r.requestedBy.name}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {r.plannedAt
                        ? new Date(r.plannedAt).toLocaleDateString('es-MX')
                        : '—'}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {r.executedAt
                        ? new Date(r.executedAt).toLocaleString('es-MX')
                        : '—'}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canApprove ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              runAction(async () => {
                                await approveCIChangeRequest({ id: r.id })
                                patchRow(r.id, { status: 'APPROVED' })
                              })
                            }
                            className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" /> Aprobar
                          </button>
                        ) : null}
                        {canExecute ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              runAction(async () => {
                                await executeCIChangeRequest({ id: r.id })
                                patchRow(r.id, {
                                  status: 'EXECUTED',
                                  executedAt: new Date().toISOString(),
                                })
                              })
                            }
                            className="inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
                          >
                            <PlayCircle className="h-3 w-3" /> Ejecutar
                          </button>
                        ) : null}
                        {canCancel ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              runAction(async () => {
                                await cancelCIChangeRequest({ id: r.id })
                                // El server decide REJECTED vs CANCELLED
                                // según si actor es owner o admin. Para
                                // reflejarlo en el UI optimista, usamos
                                // CANCELLED por convención del owner y
                                // REJECTED si el actor es ADMIN y NO es
                                // owner.
                                const next: Status =
                                  isAdmin && !isOwner ? 'REJECTED' : 'CANCELLED'
                                patchRow(r.id, { status: next })
                              })
                            }
                            className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
                          >
                            <Ban className="h-3 w-3" /> Cancelar
                          </button>
                        ) : null}
                        {!canApprove && !canExecute && !canCancel ? (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {openCreate ? (
        <CreateChangeModal
          ciId={ciId}
          pending={pending}
          onClose={() => setOpenCreate(false)}
          onCreated={(row) => {
            setRows((prev) => [row, ...prev])
            setOpenCreate(false)
          }}
          onError={setError}
          startTransition={startTransition}
        />
      ) : null}
    </div>
  )
}

function CreateChangeModal({
  ciId,
  pending,
  onClose,
  onCreated,
  onError,
  startTransition,
}: {
  ciId: string
  pending: boolean
  onClose: () => void
  onCreated: (row: CIChangeRequestRow) => void
  onError: (msg: string | null) => void
  startTransition: (cb: () => void) => void
}) {
  const [title, setTitle] = useState('')
  const [rationale, setRationale] = useState('')
  const [plannedAt, setPlannedAt] = useState('')

  function submit() {
    onError(null)
    if (!title.trim()) {
      onError('Título requerido')
      return
    }
    startTransition(() => {
      // El cierre asíncrono dentro del startTransition igual debe ser
      // async — usamos IIFE para que React rastree la transición.
      ;(async () => {
        try {
          const created = await createCIChangeRequest({
            ciId,
            title: title.trim(),
            rationale: rationale.trim() || null,
            plannedAt: plannedAt ? new Date(plannedAt) : null,
          })
          // Construimos el row optimista con datos visibles para el usuario.
          // El nombre del solicitante se rellena al refrescar la página;
          // aquí dejamos "Tú" como placeholder.
          onCreated({
            id: created.id,
            title: title.trim(),
            rationale: rationale.trim() || null,
            plannedAt: plannedAt ? new Date(plannedAt).toISOString() : null,
            executedAt: null,
            status: 'PROPOSED',
            createdAt: new Date().toISOString(),
            requestedBy: { id: '__me', name: 'Tú' },
            approvedBy: null,
          })
        } catch (e) {
          onError(e instanceof Error ? e.message : 'Error inesperado')
        }
      })()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Solicitar cambio
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 text-xs">
          <label className="block">
            <span className="mb-0.5 block font-medium text-muted-foreground">
              Título *
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-foreground"
              placeholder="Ej. Actualizar SQL Server 2019 → 2022"
              disabled={pending}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block font-medium text-muted-foreground">
              Racional / motivo
            </span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              maxLength={4000}
              rows={3}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-foreground"
              placeholder="Por qué el cambio es necesario, riesgos, mitigaciones…"
              disabled={pending}
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block font-medium text-muted-foreground">
              Ventana planeada
            </span>
            <input
              type="datetime-local"
              value={plannedAt}
              onChange={(e) => setPlannedAt(e.target.value)}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-foreground"
              disabled={pending}
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-subtle disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !title.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Solicitar
          </button>
        </div>
      </div>
    </div>
  )
}
