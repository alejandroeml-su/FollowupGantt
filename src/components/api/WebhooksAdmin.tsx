'use client'

/**
 * Cliente de administración de Webhooks (Ola P4 · Equipo P4-2).
 *
 * Permite crear/editar/eliminar webhooks outbound. El secret se muestra UNA
 * SOLA VEZ al crear; en el listado solo se ve enmascarado.
 *
 * Strings UI en español: "Webhooks", "Crear webhook", "Eventos".
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createWebhook,
  updateWebhook,
  deleteWebhook,
  type WebhookListItem,
} from '@/lib/actions/webhooks'
import { KNOWN_EVENTS } from '@/lib/webhooks/dispatcher'

interface Props {
  initialWebhooks: WebhookListItem[]
}

export function WebhooksAdmin({ initialWebhooks }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['task.created'])
  const [error, setError] = useState<string | null>(null)
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)

  const onToggleEvent = (ev: string) => {
    setSelectedEvents((curr) =>
      curr.includes(ev) ? curr.filter((e) => e !== ev) : [...curr, ev],
    )
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCreatedSecret(null)
    if (!url.trim()) {
      setError('La URL es requerida')
      return
    }
    if (selectedEvents.length === 0) {
      setError('Selecciona al menos un evento')
      return
    }
    startTransition(async () => {
      try {
        const result = await createWebhook({
          url: url.trim(),
          events: selectedEvents,
        })
        setCreatedSecret(result.secret)
        setUrl('')
        router.refresh()
      } catch (err) {
        const m = /^\[([A-Z_]+)\]\s*(.*)$/.exec(
          err instanceof Error ? err.message : String(err),
        )
        setError(m ? m[2] : String(err))
      }
    })
  }

  const onToggleActive = (id: string, active: boolean) => {
    startTransition(async () => {
      try {
        await updateWebhook({ id, active })
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const onDelete = (id: string) => {
    if (!confirm('¿Eliminar este webhook? Dejará de recibir eventos.')) return
    startTransition(async () => {
      try {
        await deleteWebhook({ id })
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // best-effort
    }
  }

  return (
    <div className="space-y-8">
      {createdSecret && (
        <div className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-4">
          <h3 className="text-sm font-semibold text-amber-200">
            Secret creado — guárdalo ahora
          </h3>
          <p className="mt-1 text-xs text-amber-100/80">
            Necesitas este secret en el receptor para verificar la firma HMAC
            (header <code>X-FollowupGantt-Signature</code>). Solo se muestra
            esta vez.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded bg-black/40 px-3 py-2 font-mono text-xs text-amber-100 break-all">
              {createdSecret}
            </code>
            <button
              type="button"
              onClick={() => onCopy(createdSecret)}
              className="rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-500"
            >
              Copiar
            </button>
            <button
              type="button"
              onClick={() => setCreatedSecret(null)}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-subtle"
            >
              Ya lo guardé
            </button>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-border bg-subtle/30 p-6">
        <h2 className="text-base font-semibold text-white">Crear webhook</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          FollowupGantt POSTea el evento JSON al endpoint que configures con
          firma HMAC SHA-256 en <code>X-FollowupGantt-Signature</code>.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="webhook-url">
              URL del receptor (https)
            </label>
            <input
              id="webhook-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhooks/followup"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-muted-foreground">Eventos suscritos</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {KNOWN_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm text-white">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(ev)}
                    onChange={() => onToggleEvent(ev)}
                  />
                  <code className="font-mono text-xs">{ev}</code>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {isPending ? 'Creando…' : 'Crear webhook'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">Webhooks existentes</h2>
        {initialWebhooks.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No tienes webhooks configurados.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {initialWebhooks.map((w) => (
              <li key={w.id} className="rounded-md border border-border bg-subtle/20 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-white break-all">
                      {w.url}
                      {!w.active && (
                        <span className="ml-2 rounded bg-muted-foreground/20 px-2 py-0.5 text-xs text-muted-foreground">
                          inactivo
                        </span>
                      )}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Secret: <code className="font-mono">{w.secretMasked}</code>
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Eventos:{' '}
                      {w.events.map((e) => (
                        <code key={e} className="mr-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">
                          {e}
                        </code>
                      ))}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Creado: {new Date(w.createdAt).toLocaleString()}
                      {w.lastDeliveryAt && (
                        <>
                          {' · Último envío: '}
                          {new Date(w.lastDeliveryAt).toLocaleString()}
                          {w.lastDeliveryStatus && ` (HTTP ${w.lastDeliveryStatus})`}
                        </>
                      )}
                      {w.failureCount > 0 && (
                        <span className="ml-1 text-red-300"> · {w.failureCount} fallos consecutivos</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleActive(w.id, !w.active)}
                      disabled={isPending}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-subtle"
                    >
                      {w.active ? 'Pausar' : 'Reanudar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(w.id)}
                      disabled={isPending}
                      className="rounded-md border border-red-500/50 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
