'use client'

/**
 * Wave P8 · Equipo P8-5 — UI de gestión de conexiones de calendario.
 *
 * Muestra:
 *   - Estado por provider (Google / Microsoft / ICS).
 *   - Toggles granulares (milestones / deadlines / sprints).
 *   - Botón "Sincronizar ahora" (manual trigger).
 *   - Token ICS público con botón "copiar" + "rotar".
 *   - Botón desconectar.
 *
 * Recibe el initial state desde el server (page.tsx). Las mutaciones
 * usan transitions + `router.refresh()` tras revalidatePath en la action.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, RefreshCw, Trash2, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { ConnectCalendarButton } from './ConnectCalendarButton'
import {
  ensureIcsConnection,
  rotateIcsToken,
  updateSyncToggles,
  deleteConnection,
  type SerializedCalendarConnection,
} from '@/lib/actions/calendar-connections'
import { triggerMyCalendarSync } from '@/lib/actions/calendar-sync'

interface Props {
  initialConnections: SerializedCalendarConnection[]
}

function findByProvider(
  list: SerializedCalendarConnection[],
  provider: 'GOOGLE' | 'MICROSOFT' | 'ICS',
): SerializedCalendarConnection | undefined {
  return list.find((c) => c.provider === provider)
}

export function CalendarSyncSettings({ initialConnections }: Props) {
  const router = useRouter()
  const [connections, setConnections] = useState(initialConnections)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const google = findByProvider(connections, 'GOOGLE')
  const microsoft = findByProvider(connections, 'MICROSOFT')
  const ics = findByProvider(connections, 'ICS')

  function withToast<T>(fn: () => Promise<T>, successMsg: string) {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      try {
        await fn()
        setMessage(successMsg)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido')
      }
    })
  }

  function handleToggle(
    conn: SerializedCalendarConnection,
    field: 'syncEnabled' | 'syncMilestones' | 'syncDeadlines' | 'syncSprints',
    value: boolean,
  ) {
    setConnections((prev) =>
      prev.map((c) => (c.id === conn.id ? { ...c, [field]: value } : c)),
    )
    withToast(
      () => updateSyncToggles({ connectionId: conn.id, [field]: value }),
      'Preferencias actualizadas',
    )
  }

  function handleEnableIcs() {
    withToast(async () => {
      const created = await ensureIcsConnection()
      setConnections((prev) => {
        const exists = prev.find((c) => c.id === created.id)
        return exists
          ? prev.map((c) => (c.id === created.id ? created : c))
          : [...prev, created]
      })
    }, 'Feed ICS habilitado')
  }

  function handleRotateIcs() {
    withToast(async () => {
      const rotated = await rotateIcsToken()
      setConnections((prev) =>
        prev.map((c) => (c.id === rotated.id ? rotated : c)),
      )
    }, 'Token rotado — el feed anterior dejó de funcionar')
  }

  function handleDelete(conn: SerializedCalendarConnection) {
    withToast(async () => {
      await deleteConnection({ connectionId: conn.id })
      setConnections((prev) => prev.filter((c) => c.id !== conn.id))
    }, 'Conexión eliminada')
  }

  function handleSyncNow() {
    withToast(async () => {
      await triggerMyCalendarSync()
    }, 'Sincronización completada')
  }

  function handleCopyIcs(token: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      const url = `${window.location.origin}/api/calendar/ics/${token}`
      navigator.clipboard
        .writeText(url)
        .then(() => setMessage('URL copiada al portapapeles'))
        .catch(() => setError('No se pudo copiar la URL'))
    }
  }

  return (
    <div className="space-y-6" data-testid="calendar-sync-settings">
      {message && (
        <div
          role="status"
          className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        >
          {message}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {/* Botón sincronizar manual */}
      <button
        type="button"
        onClick={handleSyncNow}
        disabled={isPending || connections.length === 0}
        data-testid="calendar-sync-now-button"
        className={clsx(
          'inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60',
        )}
      >
        <Zap className="h-4 w-4" aria-hidden="true" />
        Sincronizar ahora
      </button>

      {/* Google */}
      <section className="rounded-xl border bg-card p-6">
        <h3 className="mb-3 text-lg font-semibold">Google Calendar</h3>
        <ConnectCalendarButton
          provider="google"
          connected={Boolean(google?.hasAccessToken)}
        />
        {google && (
          <ConnectionToggles
            connection={google}
            onToggle={handleToggle}
            onDelete={handleDelete}
            isPending={isPending}
          />
        )}
      </section>

      {/* Microsoft */}
      <section className="rounded-xl border bg-card p-6">
        <h3 className="mb-3 text-lg font-semibold">Microsoft Outlook</h3>
        <ConnectCalendarButton
          provider="microsoft"
          connected={Boolean(microsoft?.hasAccessToken)}
        />
        {microsoft && (
          <ConnectionToggles
            connection={microsoft}
            onToggle={handleToggle}
            onDelete={handleDelete}
            isPending={isPending}
          />
        )}
      </section>

      {/* ICS feed público */}
      <section className="rounded-xl border bg-card p-6">
        <h3 className="mb-3 text-lg font-semibold">
          Feed ICS universal (Apple Calendar, Thunderbird, etc.)
        </h3>
        {!ics && (
          <button
            type="button"
            onClick={handleEnableIcs}
            disabled={isPending}
            data-testid="enable-ics-button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            Habilitar feed ICS
          </button>
        )}
        {ics?.icsToken && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-md bg-muted p-3 sm:flex-row sm:items-center">
              <code
                data-testid="ics-feed-url"
                className="flex-1 truncate text-xs"
              >
                {`/api/calendar/ics/${ics.icsToken}`}
              </code>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyIcs(ics.icsToken as string)}
                  className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs hover:bg-secondary/80"
                  data-testid="copy-ics-url-button"
                >
                  <Copy className="h-3 w-3" /> Copiar
                </button>
                <button
                  type="button"
                  onClick={handleRotateIcs}
                  className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-200"
                  data-testid="rotate-ics-token-button"
                >
                  <RefreshCw className="h-3 w-3" /> Rotar token
                </button>
              </div>
            </div>
            <ConnectionToggles
              connection={ics}
              onToggle={handleToggle}
              onDelete={handleDelete}
              isPending={isPending}
            />
          </div>
        )}
      </section>
    </div>
  )
}

interface TogglesProps {
  connection: SerializedCalendarConnection
  onToggle: (
    conn: SerializedCalendarConnection,
    field: 'syncEnabled' | 'syncMilestones' | 'syncDeadlines' | 'syncSprints',
    value: boolean,
  ) => void
  onDelete: (conn: SerializedCalendarConnection) => void
  isPending: boolean
}

function ConnectionToggles({
  connection,
  onToggle,
  onDelete,
  isPending,
}: TogglesProps) {
  return (
    <div className="mt-4 space-y-2 border-t pt-4">
      <ToggleRow
        label="Sincronización habilitada"
        checked={connection.syncEnabled}
        onChange={(v) => onToggle(connection, 'syncEnabled', v)}
        testId={`toggle-syncEnabled-${connection.provider}`}
      />
      <ToggleRow
        label="Milestones"
        checked={connection.syncMilestones}
        onChange={(v) => onToggle(connection, 'syncMilestones', v)}
        testId={`toggle-syncMilestones-${connection.provider}`}
      />
      <ToggleRow
        label="Hard deadlines"
        checked={connection.syncDeadlines}
        onChange={(v) => onToggle(connection, 'syncDeadlines', v)}
        testId={`toggle-syncDeadlines-${connection.provider}`}
      />
      <ToggleRow
        label="Sprints"
        checked={connection.syncSprints}
        onChange={(v) => onToggle(connection, 'syncSprints', v)}
        testId={`toggle-syncSprints-${connection.provider}`}
      />
      <button
        type="button"
        onClick={() => onDelete(connection)}
        disabled={isPending}
        data-testid={`delete-connection-${connection.provider}`}
        className="mt-2 inline-flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-xs text-red-900 hover:bg-red-200 dark:bg-red-950 dark:text-red-200"
      >
        <Trash2 className="h-3 w-3" /> Desconectar
      </button>
    </div>
  )
}

interface ToggleRowProps {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  testId: string
}

function ToggleRow({ label, checked, onChange, testId }: ToggleRowProps) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="h-4 w-4 rounded border-input"
      />
    </label>
  )
}
