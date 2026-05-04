import { Monitor, Smartphone } from 'lucide-react'
import { listActiveSessions, describeUserAgent } from '@/lib/auth/sessions'
import {
  revokeSessionAction,
  revokeOtherSessionsAction,
} from './actions'

/**
 * Página "Sesiones activas" (Ola P3 · Auth).
 *
 * Server component — carga las sesiones del usuario y las renderiza.
 * Cada fila tiene un form que dispara `revokeSessionAction(sessionId)`.
 */
export const dynamic = 'force-dynamic'

export default async function SessionsPage() {
  const sessions = await listActiveSessions()

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Sesiones activas
          </h1>
          <p className="text-sm text-muted-foreground">
            Dispositivos donde tu cuenta está iniciada actualmente.
          </p>
        </div>
        {sessions.length > 1 ? (
          <form action={revokeOtherSessionsAction}>
            <button
              type="submit"
              data-testid="sessions-revoke-others"
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/40"
            >
              Cerrar otras sesiones
            </button>
          </form>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No tienes sesiones activas.
        </p>
      ) : (
        <ul
          data-testid="sessions-list"
          className="divide-y divide-border rounded-2xl border border-border bg-card"
        >
          {sessions.map((s) => (
            <li
              key={s.id}
              data-testid={`session-row-${s.id}`}
              className="flex flex-wrap items-center gap-4 p-4"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/40">
                {/iphone|ipad|android/i.test(s.userAgent ?? '') ? (
                  <Smartphone className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Monitor className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {describeUserAgent(s.userAgent)}
                  {s.isCurrent ? (
                    <span
                      data-testid="session-current-badge"
                      className="ml-2 inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
                    >
                      Esta sesión
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {s.ipAddress ?? 'IP desconocida'}
                  {' · '}
                  {s.lastSeenAt
                    ? `Última actividad: ${formatDate(s.lastSeenAt)}`
                    : `Iniciada: ${formatDate(s.createdAt)}`}
                </p>
              </div>
              {!s.isCurrent ? (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <button
                    type="submit"
                    data-testid={`session-revoke-${s.id}`}
                    className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"
                  >
                    Revocar
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}
