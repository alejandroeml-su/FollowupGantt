'use client'

/**
 * Wave P8 · Equipo P8-5 — Botón "Conectar Google/Microsoft Calendar".
 *
 * El click redirige al endpoint OAuth del worktree
 * `/calendar-sync/{provider}/callback` (sub-flow autorización inicial).
 * Tras consent, el callback persiste tokens y vuelve a /settings/calendar.
 *
 * Estados visuales:
 *   - `connected=true` → botón "Reconectar" + badge verde de estado.
 *   - `connected=false` → botón "Conectar".
 *
 * Errores se exponen vía query param `?error=` que el page server-side
 * lee — este componente solo dispara la navegación.
 */

import { useState } from 'react'
import { Calendar, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'

type Provider = 'google' | 'microsoft'

interface Props {
  provider: Provider
  connected: boolean
  className?: string
  /** Para tests: override del callback del click. */
  onConnect?: (provider: Provider) => void
}

const PROVIDER_LABELS: Record<Provider, { label: string; brand: string }> = {
  google: { label: 'Google Calendar', brand: 'bg-red-600 hover:bg-red-700' },
  microsoft: {
    label: 'Microsoft Outlook',
    brand: 'bg-blue-600 hover:bg-blue-700',
  },
}

export function ConnectCalendarButton({
  provider,
  connected,
  className,
  onConnect,
}: Props) {
  const [busy, setBusy] = useState(false)
  const config = PROVIDER_LABELS[provider]

  function handleClick() {
    setBusy(true)
    if (onConnect) {
      onConnect(provider)
      setBusy(false)
      return
    }
    // Default: navegación full a callback en sub-flow "iniciar".
    window.location.href = `/calendar-sync/${provider}/callback`
  }

  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        data-testid={`connect-calendar-${provider}`}
        data-state={connected ? 'connected' : 'disconnected'}
        className={clsx(
          'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-all focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60',
          config.brand,
        )}
        aria-busy={busy}
      >
        {connected ? (
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Calendar className="h-4 w-4" aria-hidden="true" />
        )}
        <span>
          {connected
            ? `Reconectar ${config.label}`
            : `Conectar ${config.label}`}
        </span>
      </button>
      {connected && (
        <p
          className="text-xs text-emerald-700 dark:text-emerald-400"
          role="status"
          data-testid={`connect-calendar-${provider}-status`}
        >
          Conectado — los milestones, deadlines y sprints habilitados se
          sincronizarán cada 4 horas.
        </p>
      )}
    </div>
  )
}
