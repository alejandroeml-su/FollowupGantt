/**
 * Wave P8 · Equipo P8-5 — Página `/settings/calendar`.
 *
 * Server component: carga el usuario actual + sus conexiones de
 * calendario y delega la UI interactiva a `CalendarSyncSettings`
 * (client component). Lee también el query param `?error=` que el
 * callback OAuth setea en errores.
 */

import { getCurrentUser } from '@/lib/auth'
import { listMyCalendarConnections } from '@/lib/actions/calendar-connections'
import { CalendarSyncSettings } from '@/components/calendar-sync/CalendarSyncSettings'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ error?: string; ok?: string }>
}

const ERROR_LABELS: Record<string, string> = {
  CALSYNC_DISABLED:
    'OAuth aún no configurado. Solicita a tu administrador las credenciales del provider.',
  CALSYNC_STATE_MISSING:
    'La sesión OAuth expiró. Inténtalo nuevamente.',
  CALSYNC_STATE_MISMATCH:
    'Validación de seguridad fallida. Inténtalo nuevamente.',
  CALSYNC_EXCHANGE_FAILED:
    'No se pudieron obtener los tokens del provider. Verifica permisos.',
  CALSYNC_PROVIDER_DESCONOCIDO: 'Provider no soportado.',
  CALSYNC_ERROR: 'Error inesperado durante el flujo OAuth.',
}

export default async function CalendarSyncSettingsPage({
  searchParams,
}: PageProps) {
  const user = await getCurrentUser()
  const params = await searchParams

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold">Calendar sync</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Inicia sesión para gestionar tus conexiones de calendario.
        </p>
      </main>
    )
  }

  const connections = await listMyCalendarConnections()

  return (
    <main
      data-testid="calendar-sync-page"
      className="mx-auto max-w-3xl px-6 py-10"
    >
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Calendar sync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sincroniza milestones, hard deadlines y sprints con Google Calendar,
          Microsoft Outlook o cualquier cliente compatible con iCalendar.
        </p>
      </header>

      {params.error && (
        <div
          role="alert"
          className="mb-6 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {ERROR_LABELS[params.error] ?? params.error}
        </div>
      )}
      {params.ok && (
        <div
          role="status"
          className="mb-6 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        >
          Conexión completada. Próxima sincronización en menos de 4 horas.
        </div>
      )}

      <CalendarSyncSettings initialConnections={connections} />
    </main>
  )
}
