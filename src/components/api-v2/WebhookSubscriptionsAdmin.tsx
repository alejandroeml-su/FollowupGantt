'use client'

/**
 * Wave P17-B · Cliente admin de Webhook Subscriptions v2.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  type WebhookSubListItem,
} from '@/lib/actions/webhook-subscriptions'
import { KNOWN_V2_EVENTS } from '@/lib/webhooks-out/events'

interface Props {
  initialSubs: WebhookSubListItem[]
}

export function WebhookSubscriptionsAdmin({ initialSubs }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    ...KNOWN_V2_EVENTS,
  ])
  const [error, setError] = useState<string | null>(null)
  const [createdSecret, setCreatedSecret] = useState<{
    id: string
    secret: string
  } | null>(null)

  const parseError = (err: unknown): string => {
    const m = /^\[([A-Z_]+)\]\s*(.*)$/.exec(
      err instanceof Error ? err.message : String(err),
    )
    return m ? m[2] : String(err)
  }

  const onToggleEvent = (event: string) => {
    setSelectedEvents((curr) =>
      curr.includes(event) ? curr.filter((e) => e !== event) : [...curr, event],
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
        const result = await createWebhookSubscription({
          url: url.trim(),
          events: selectedEvents,
        })
        setCreatedSecret({ id: result.id, secret: result.secret })
        setUrl('')
        router.refresh()
      } catch (err) {
        setError(parseError(err))
      }
    })
  }

  const onToggleActive = (id: string, active: boolean) => {
    startTransition(async () => {
      try {
        await updateWebhookSubscription({ id, active: !active })
        router.refresh()
      } catch (err) {
        setError(parseError(err))
      }
    })
  }

  const onDelete = (id: string) => {
    if (!confirm('¿Eliminar este webhook? Se borra el histórico de entregas.'))
      return
    startTransition(async () => {
      try {
        await deleteWebhookSubscription({ id })
        router.refresh()
      } catch (err) {
        setError(parseError(err))
      }
    })
  }

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      /* best-effort */
    }
  }

  return (
    <div className="space-y-8">
      {createdSecret && (
        <div className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-4">
          <h3 className="text-sm font-semibold text-amber-200">
            Webhook creado — guarda el secret ahora
          </h3>
          <p className="mt-1 text-xs text-amber-100/80">
            Usa este secret para verificar la firma HMAC SHA-256 que llega en
            el header <code>X-Signature-256</code>. No se mostrará de nuevo.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 rounded bg-black/40 px-3 py-2 font-mono text-xs text-amber-100 break-all">
              {createdSecret.secret}
            </code>
            <button
              type="button"
              onClick={() => onCopy(createdSecret.secret)}
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
          Sync envía POST con body JSON firmado. Reintentos: 1s · 5s · 30s
          (3 retries). Auto-disable tras 10 fallos consecutivos.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label
              className="block text-xs font-medium text-muted-foreground"
              htmlFor="webhook-url"
            >
              URL
            </label>
            <input
              id="webhook-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhooks/sync"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-muted-foreground">
              Eventos
            </span>
            <div className="mt-2 grid grid-cols-1 gap-2">
              {KNOWN_V2_EVENTS.map((event) => (
                <label
                  key={event}
                  className="flex items-center gap-2 text-sm text-white"
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={() => onToggleEvent(event)}
                  />
                  <code className="font-mono text-xs">{event}</code>
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
        <h2 className="text-base font-semibold text-white">
          Webhooks existentes
        </h2>
        {initialSubs.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Aún no hay webhooks en este workspace.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {initialSubs.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-border bg-subtle/20 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-white break-all">
                      {s.url}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Eventos:{' '}
                      {s.events.map((e) => (
                        <code
                          key={e}
                          className="mr-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]"
                        >
                          {e}
                        </code>
                      ))}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Secret: {s.secretPrefix}… · Estado:{' '}
                      <span
                        className={
                          s.active
                            ? 'text-emerald-300'
                            : 'text-amber-200'
                        }
                      >
                        {s.active ? 'activo' : 'pausado'}
                      </span>
                      {s.failureCount > 0 &&
                        ` · ${s.failureCount} fallos consecutivos`}
                      {s.lastDeliveryAt &&
                        ` · Último: ${new Date(s.lastDeliveryAt).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleActive(s.id, s.active)}
                      disabled={isPending}
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-subtle"
                    >
                      {s.active ? 'Pausar' : 'Reactivar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(s.id)}
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
