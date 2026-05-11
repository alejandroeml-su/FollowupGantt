'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, PlayCircle, RotateCw } from 'lucide-react'
import {
  createAuditStreamTarget,
  updateAuditStreamTarget,
  deleteAuditStreamTarget,
  testAuditStreamTarget,
  retryAuditStreamDelivery,
} from '@/lib/actions/audit-streaming'

type Kind = 'SPLUNK' | 'DATADOG' | 'GENERIC_WEBHOOK'
type DeliveryStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING'

export type AuditStreamTargetRow = {
  id: string
  workspaceId: string
  kind: Kind
  endpoint: string
  batchSize: number
  enabled: boolean
  lastDeliveryAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type AuditStreamDeliveryRow = {
  id: string
  targetId: string
  targetEndpoint: string
  targetKind: Kind
  workspaceId: string
  batchId: string
  count: number
  status: DeliveryStatus
  attempt: number
  lastError: string | null
  createdAt: string
  deliveredAt: string | null
}

export type WorkspaceLite = { id: string; name: string; slug: string }

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[[A-Z_]+\]\s*/, '')
  }
  return 'Error desconocido'
}

const KIND_LABEL: Record<Kind, string> = {
  SPLUNK: 'Splunk HEC',
  DATADOG: 'Datadog Logs',
  GENERIC_WEBHOOK: 'Webhook genérico (HMAC)',
}

const STATUS_COLOR: Record<DeliveryStatus, string> = {
  PENDING: 'bg-slate-500/15 text-slate-300',
  RETRYING: 'bg-amber-500/15 text-amber-300',
  SUCCESS: 'bg-emerald-500/15 text-emerald-300',
  FAILED: 'bg-red-500/15 text-red-300',
}

export function AuditStreamingClient({
  targets,
  workspaces,
  recentDeliveries,
}: {
  targets: AuditStreamTargetRow[]
  workspaces: WorkspaceLite[]
  recentDeliveries: AuditStreamDeliveryRow[]
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; row: AuditStreamTargetRow } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const closeDialog = () => setDialog(null)

  const onDelete = (row: AuditStreamTargetRow) => {
    if (!confirm(`¿Eliminar destino ${KIND_LABEL[row.kind]} ${row.endpoint}?`)) return
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        await deleteAuditStreamTarget({ id: row.id })
        setInfo('Destino eliminado.')
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  const onTest = (row: AuditStreamTargetRow) => {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        await testAuditStreamTarget({ id: row.id })
        setInfo(`Evento de prueba enviado a ${KIND_LABEL[row.kind]}.`)
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  const onRetry = (id: string) => {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        await retryAuditStreamDelivery({ id })
        setInfo('Delivery reseteada — se reintentará en el próximo cron.')
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">
          Destinos configurados ({targets.length})
        </h2>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setInfo(null)
            setDialog({ mode: 'create' })
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nuevo destino
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {info && (
        <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {info}
        </div>
      )}

      {targets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground">
          No hay destinos configurados. Crea uno para empezar a reenviar
          eventos a tu SIEM.
        </div>
      ) : (
        <ul className="space-y-3">
          {targets.map((t) => (
            <li
              key={t.id}
              className="rounded-2xl border border-border bg-card/40 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-200">
                      {KIND_LABEL[t.kind]}
                    </span>
                    {t.enabled ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                        Activo
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                        Inactivo
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      Workspace: {workspaces.find((w) => w.id === t.workspaceId)?.name ?? t.workspaceId}
                    </span>
                  </div>
                  <div className="mt-2 truncate font-mono text-sm text-foreground/90" title={t.endpoint}>
                    {t.endpoint}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    batchSize={t.batchSize} · última entrega: {t.lastDeliveryAt ? new Date(t.lastDeliveryAt).toLocaleString() : 'nunca'}
                  </div>
                  {t.lastError && (
                    <div className="mt-1 text-xs text-red-300" title={t.lastError}>
                      Último error: {t.lastError.slice(0, 200)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onTest(t)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-subtle px-2.5 py-1.5 text-xs hover:bg-card transition-colors"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    Probar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setInfo(null)
                      setDialog({ mode: 'edit', row: t })
                    }}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-subtle px-2.5 py-1.5 text-xs hover:bg-card transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(t)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Eliminar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">
          Últimas 20 entregas
        </h2>
        {recentDeliveries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/30 px-6 py-8 text-center text-sm text-muted-foreground">
            Aún no hay entregas registradas.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-card/60">
                <tr>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Cuando</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Destino</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Eventos</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Intento</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Error</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentDeliveries.map((d) => (
                  <tr key={d.id} className="bg-card/30">
                    <td className="px-3 py-2 text-foreground/80">
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground/80" title={d.targetEndpoint}>
                      {KIND_LABEL[d.targetKind]} · {d.targetEndpoint.slice(0, 40)}…
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[d.status]}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground/80">{d.count}</td>
                    <td className="px-3 py-2 text-foreground/80">{d.attempt}</td>
                    <td className="px-3 py-2 text-red-200" title={d.lastError ?? undefined}>
                      {d.lastError ? d.lastError.slice(0, 60) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {(d.status === 'FAILED' || d.status === 'RETRYING') && (
                        <button
                          type="button"
                          onClick={() => onRetry(d.id)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/20 transition-colors"
                        >
                          <RotateCw className="h-3 w-3" />
                          Reintentar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog && (
        <TargetDialog
          mode={dialog.mode}
          row={dialog.mode === 'edit' ? dialog.row : null}
          workspaces={workspaces}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog()
            router.refresh()
          }}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  )
}

function TargetDialog({
  mode,
  row,
  workspaces,
  onClose,
  onSaved,
  onError,
}: {
  mode: 'create' | 'edit'
  row: AuditStreamTargetRow | null
  workspaces: WorkspaceLite[]
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const [workspaceId, setWorkspaceId] = useState(row?.workspaceId ?? workspaces[0]?.id ?? '')
  const [kind, setKind] = useState<Kind>(row?.kind ?? 'GENERIC_WEBHOOK')
  const [endpoint, setEndpoint] = useState(row?.endpoint ?? '')
  const [secret, setSecret] = useState('')
  const [batchSize, setBatchSize] = useState<number>(row?.batchSize ?? 100)
  const [enabled, setEnabled] = useState(row?.enabled ?? true)
  const [isPending, startTransition] = useTransition()

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault()
    startTransition(async () => {
      try {
        if (mode === 'create') {
          await createAuditStreamTarget({
            workspaceId,
            kind,
            endpoint,
            secret,
            batchSize,
            enabled,
          })
        } else if (row) {
          await updateAuditStreamTarget({
            id: row.id,
            endpoint,
            ...(secret ? { secret } : {}),
            batchSize,
            enabled,
          })
        }
        onSaved()
      } catch (err) {
        onError(err instanceof Error ? err.message.replace(/^\[[A-Z_]+\]\s*/, '') : 'Error')
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <h3 className="text-base font-semibold text-foreground">
          {mode === 'create' ? 'Nuevo destino SIEM' : 'Editar destino'}
        </h3>
        <div className="mt-4 space-y-4">
          {mode === 'create' && (
            <label className="block text-xs font-medium text-muted-foreground">
              Workspace
              <select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.slug})</option>
                ))}
              </select>
            </label>
          )}
          {mode === 'create' && (
            <label className="block text-xs font-medium text-muted-foreground">
              Tipo
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="SPLUNK">Splunk HEC</option>
                <option value="DATADOG">Datadog Logs API v2</option>
                <option value="GENERIC_WEBHOOK">Webhook genérico (HMAC-SHA256)</option>
              </select>
            </label>
          )}
          <label className="block text-xs font-medium text-muted-foreground">
            Endpoint (URL https://…)
            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              required
              placeholder="https://hec.splunkcloud.com/services/collector"
              className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Secret / Token
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required={mode === 'create'}
              placeholder={mode === 'edit' ? 'Dejar vacío para mantener' : 'Token HEC, DD-API-KEY o HMAC secret'}
              className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground"
            />
          </label>
          <div className="flex items-center gap-4">
            <label className="flex-1 block text-xs font-medium text-muted-foreground">
              Batch size (1–1000)
              <input
                type="number"
                min={1}
                max={1000}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value) || 100)}
                className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground pt-5">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Activo
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-border bg-subtle px-4 py-2 text-sm hover:bg-card transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-60"
          >
            {isPending ? 'Guardando…' : mode === 'create' ? 'Crear destino' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}
