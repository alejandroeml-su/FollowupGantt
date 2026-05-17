'use client'

/**
 * Wave R5 Extended · US R5E-Marketplace · Catálogo + drawer de config.
 *
 * Listado de providers disponibles (del registry, no de BD) con badge
 * "Conectado" si hay un `IntegrationInstall` activo. Click en un provider
 * abre un drawer con el form de config (provider-specific).
 *
 * Patrón consistente con `IntegrationsList` (P4): estado local + transitions,
 * los cambios persisten vía server actions (`installIntegration`,
 * `disconnectIntegration`). Tras mutar se refresca el listado.
 */

import { useState, useTransition } from 'react'
import {
  installIntegration,
  disconnectIntegration,
  type SerializedIntegrationInstall,
} from '@/lib/actions/marketplace'
import { MARKETPLACE_EVENTS, type MarketplaceEvent } from '@/lib/integrations/shared'

export interface ProviderCardData {
  key: string
  kind: string
  name: string
  description: string
  iconUrl: string
  webhookEvents: string[]
  docsUrl?: string
}

interface Props {
  workspaceId: string
  providers: ProviderCardData[]
  installs: SerializedIntegrationInstall[]
}

export function MarketplaceCatalog({ workspaceId, providers, installs }: Props) {
  const [installsState, setInstallsState] = useState(installs)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const findInstall = (key: string) =>
    installsState.find((i) => i.providerKey === key && i.status !== 'DISCONNECTED')

  const handleInstall = (providerKey: string, config: Record<string, unknown>) => {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        const created = await installIntegration({
          workspaceId,
          providerKey,
          config,
        })
        setInstallsState((prev) => {
          const without = prev.filter((i) => i.providerKey !== providerKey)
          return [...without, created]
        })
        setOpenKey(null)
        setSuccess(`Integración ${providerKey} conectada`)
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const handleDisconnect = (installId: string, name: string) => {
    setError(null)
    setSuccess(null)
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`¿Desconectar "${name}"? Las notificaciones dejarán de enviarse.`)
    ) {
      return
    }
    startTransition(async () => {
      try {
        await disconnectIntegration({ installId })
        setInstallsState((prev) =>
          prev.map((i) => (i.id === installId ? { ...i, status: 'DISCONNECTED' } : i)),
        )
        setSuccess('Integración desconectada')
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="space-y-4" data-testid="marketplace-catalog">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-foreground">Marketplace</h2>
          <p className="text-xs text-muted-foreground">
            Conecta Sync con servicios externos. Los tokens se guardan
            cifrados en una próxima iteración.
          </p>
        </div>
      </header>

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

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {providers.map((p) => {
          const install = findInstall(p.key)
          return (
            <li
              key={p.key}
              className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
              data-testid={`marketplace-card-${p.key}`}
            >
              <div className="flex items-start gap-3">
                <ProviderIcon kind={p.kind} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">{p.name}</h3>
                    {install ? (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 uppercase">
                        Conectado
                      </span>
                    ) : (
                      <span className="rounded bg-zinc-500/15 px-2 py-0.5 text-[10px] font-semibold text-zinc-300 uppercase">
                        Disponible
                      </span>
                    )}
                    {install?.status === 'ERROR' && (
                      <span className="rounded bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300 uppercase">
                        Error
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                {install ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpenKey(p.key)}
                      disabled={isPending}
                      className="rounded-md border border-border bg-secondary px-3 py-1 text-xs text-foreground/90 hover:bg-secondary/80 transition disabled:opacity-50"
                    >
                      Reconfigurar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDisconnect(install.id, p.name)}
                      disabled={isPending}
                      className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-300 hover:bg-red-500/20 transition disabled:opacity-50"
                    >
                      Desconectar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenKey(p.key)}
                    disabled={isPending}
                    className="rounded-md bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition disabled:opacity-50"
                  >
                    Conectar
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {openKey === 'slack' && (
        <ConfigDrawer
          title="Conectar Slack"
          onClose={() => setOpenKey(null)}
          isPending={isPending}
        >
          <SlackConfigForm
            onSubmit={(cfg) => handleInstall('slack', cfg)}
            disabled={isPending}
          />
        </ConfigDrawer>
      )}
      {openKey === 'github' && (
        <ConfigDrawer
          title="Conectar GitHub"
          onClose={() => setOpenKey(null)}
          isPending={isPending}
        >
          <GithubConfigForm
            onSubmit={(cfg) => handleInstall('github', cfg)}
            disabled={isPending}
          />
        </ConfigDrawer>
      )}
    </div>
  )
}

function ProviderIcon({ kind }: { kind: string }) {
  const label =
    kind === 'comms' ? 'COM' : kind === 'code' ? 'CODE' : kind === 'design' ? 'DSG' : 'EXT'
  return (
    <div className="h-10 w-10 shrink-0 rounded-md bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-[9px] font-bold text-indigo-300 uppercase">
      {label}
    </div>
  )
}

interface DrawerProps {
  title: string
  onClose: () => void
  isPending: boolean
  children: React.ReactNode
}

function ConfigDrawer({ title, onClose, isPending, children }: DrawerProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/40"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-md overflow-y-auto bg-card border-l border-border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-border bg-secondary px-2 py-1 text-xs text-foreground/90"
          >
            Cerrar
          </button>
        </header>
        {children}
      </aside>
    </div>
  )
}

// ─────────────── Slack form ───────────────

function SlackConfigForm(props: {
  onSubmit: (cfg: Record<string, unknown>) => void
  disabled: boolean
}) {
  const [botToken, setBotToken] = useState('')
  const [defaultChannel, setDefaultChannel] = useState('#general')
  const [events, setEvents] = useState<MarketplaceEvent[]>([
    'task.assigned',
    'task.completed',
  ])

  const toggleEvent = (ev: MarketplaceEvent) => {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    )
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        props.onSubmit({ botToken, defaultChannel, events })
      }}
    >
      <div>
        <label className="block text-xs font-medium text-foreground/80 mb-1">
          Bot Token (xoxb-…)
        </label>
        <input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder="xoxb-1234..."
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Slack App → OAuth & Permissions → Bot User OAuth Token.
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium text-foreground/80 mb-1">
          Canal default
        </label>
        <input
          type="text"
          value={defaultChannel}
          onChange={(e) => setDefaultChannel(e.target.value)}
          placeholder="#general"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>
      <fieldset>
        <legend className="block text-xs font-medium text-foreground/80 mb-2">
          Eventos a notificar
        </legend>
        <div className="space-y-2">
          {MARKETPLACE_EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-xs text-foreground/80">
              <input
                type="checkbox"
                checked={events.includes(ev)}
                onChange={() => toggleEvent(ev)}
                className="rounded border-border"
              />
              {ev}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="submit"
        disabled={props.disabled}
        className="w-full rounded-md bg-indigo-500/20 px-3 py-2 text-sm font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition disabled:opacity-50"
      >
        Conectar Slack
      </button>
    </form>
  )
}

// ─────────────── GitHub form ───────────────

function GithubConfigForm(props: {
  onSubmit: (cfg: Record<string, unknown>) => void
  disabled: boolean
}) {
  const [token, setToken] = useState('')
  const [defaultRepo, setDefaultRepo] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        const cfg: Record<string, unknown> = { token, defaultRepo }
        if (webhookSecret) cfg.webhookSecret = webhookSecret
        props.onSubmit(cfg)
      }}
    >
      <div>
        <label className="block text-xs font-medium text-foreground/80 mb-1">
          Personal Access Token
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_… o github_pat_…"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          GitHub → Settings → Developer settings → PAT. Scopes mínimos: `repo`.
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium text-foreground/80 mb-1">
          Repo default (owner/name)
        </label>
        <input
          type="text"
          value={defaultRepo}
          onChange={(e) => setDefaultRepo(e.target.value)}
          placeholder="alejandroeml-su/FollowupGantt"
          required
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-foreground/80 mb-1">
          Webhook secret (opcional)
        </label>
        <input
          type="password"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder="(usado para validar webhooks inbound)"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>
      <button
        type="submit"
        disabled={props.disabled}
        className="w-full rounded-md bg-indigo-500/20 px-3 py-2 text-sm font-medium text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition disabled:opacity-50"
      >
        Conectar GitHub
      </button>
    </form>
  )
}
