'use client'

/**
 * Listado y administración de integraciones del workspace.
 *
 * Patrón consistente con `CalendarsAdmin`: estado local + transitions, los
 * cambios persisten vía server actions (`createIntegration`, `updateIntegration`,
 * `deleteIntegration`, `testIntegrationWebhook`). Tras mutar se recarga la
 * página para tomar nuevos datos del server (soft-refresh).
 */

import { useState, useTransition } from 'react'
import { AddIntegrationDialog, type AddIntegrationPayload } from './AddIntegrationDialog'
import {
  createIntegration,
  deleteIntegration,
  testIntegrationWebhook,
  updateIntegration,
  type SerializedIntegration,
} from '@/lib/actions/integrations'
import type { IntegrationType } from '@prisma/client'

interface Props {
  initial: SerializedIntegration[]
}

export function IntegrationsList({ initial }: Props) {
  const [items, setItems] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleAdd = (payload: AddIntegrationPayload) => {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        const created = await createIntegration({
          type: payload.type,
          name: payload.name,
          config: payload.config as Record<string, unknown>,
        })
        setItems((prev) => [...prev, created])
        setShowAdd(false)
        setSuccess(`Integración ${payload.name} creada`)
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleDelete = (id: string, name: string) => {
    setError(null)
    setSuccess(null)
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`¿Eliminar la integración "${name}"? No se puede deshacer.`)
    ) {
      return
    }
    startTransition(async () => {
      try {
        await deleteIntegration(id)
        setItems((prev) => prev.filter((i) => i.id !== id))
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleToggle = (item: SerializedIntegration) => {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        const updated = await updateIntegration({
          id: item.id,
          enabled: !item.enabled,
        })
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleTest = (item: SerializedIntegration) => {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        const result = await testIntegrationWebhook(item.id)
        if (result.ok) {
          setSuccess(`Probar webhook OK (${item.name})`)
        } else {
          setError(`Probar webhook falló: ${result.error ?? 'desconocido'}`)
        }
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="space-y-6" data-testid="integrations-list">
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {success}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-white">
          {items.length} integración(es) configurada(s)
        </h2>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          disabled={isPending}
          className="rounded-md bg-indigo-500/20 px-3 py-1.5 text-sm font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition disabled:opacity-50"
          data-testid="btn-add-integration"
        >
          + Añadir
        </button>
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          No hay integraciones configuradas. Conecta Slack, Teams o GitHub.
        </div>
      )}

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-border bg-card p-4"
            data-testid={`integration-row-${item.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300 uppercase">
                    {typeLabel(item.type)}
                  </span>
                  <h3 className="font-semibold text-white">{item.name}</h3>
                  {!item.enabled && (
                    <span className="rounded bg-zinc-500/15 px-2 py-0.5 text-[10px] font-semibold text-zinc-300 uppercase">
                      Deshabilitada
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground break-all">
                  {summarizeConfig(item)}
                </p>
              </div>
              <div className="flex flex-col gap-2 items-end">
                {item.type !== 'GITHUB' && (
                  <button
                    type="button"
                    onClick={() => handleTest(item)}
                    disabled={isPending || !item.enabled}
                    className="rounded-md border border-border bg-secondary px-3 py-1 text-xs text-foreground/90 hover:bg-secondary/80 transition disabled:opacity-50"
                  >
                    Probar webhook
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleToggle(item)}
                  disabled={isPending}
                  className="rounded-md border border-border bg-secondary px-3 py-1 text-xs text-foreground/90 hover:bg-secondary/80 transition disabled:opacity-50"
                >
                  {item.enabled ? 'Deshabilitar' : 'Habilitar'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id, item.name)}
                  disabled={isPending}
                  className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-300 hover:bg-red-500/20 transition disabled:opacity-50"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <AddIntegrationDialog
        open={showAdd}
        disabled={isPending}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAdd}
      />
    </div>
  )
}

function typeLabel(type: IntegrationType): string {
  if (type === 'SLACK') return 'Slack'
  if (type === 'TEAMS') return 'Teams'
  return 'GitHub'
}

function summarizeConfig(item: SerializedIntegration): string {
  const cfg = (item.config ?? {}) as Record<string, unknown>
  if (item.type === 'SLACK' || item.type === 'TEAMS') {
    const url = typeof cfg.webhookUrl === 'string' ? cfg.webhookUrl : ''
    return url
      ? `Webhook: ${maskUrl(url)}`
      : 'Webhook URL no configurada'
  }
  // GITHUB
  const repo = typeof cfg.defaultRepo === 'string' ? cfg.defaultRepo : null
  return repo ? `Repositorio por defecto: ${repo}` : 'Sin repositorio por defecto'
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.split('/').slice(0, 3).join('/')}/…`
  } catch {
    return url.slice(0, 32) + '…'
  }
}
