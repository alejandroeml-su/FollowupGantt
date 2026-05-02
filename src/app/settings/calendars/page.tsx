/**
 * Página admin de Calendarios laborales (Ola P1.5).
 *
 * Lista los WorkCalendar existentes (con holidays + count de proyectos)
 * y permite crear/editar/eliminar mediante client components.
 *
 * Strings UI en español: "Calendarios laborales", "Festivos", etc.
 */

import { CalendarsAdmin } from '@/components/calendars/CalendarsAdmin'
import { getCalendarsForOrg } from '@/lib/actions/calendars'

export const dynamic = 'force-dynamic'

export default async function CalendarsSettingsPage() {
  let calendars: Awaited<ReturnType<typeof getCalendarsForOrg>> = []
  try {
    calendars = await getCalendarsForOrg()
  } catch {
    // Migración pendiente: la tabla aún no existe ⇒ render en blanco con CTA.
    calendars = []
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Calendarios laborales</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Define días no-hábiles (festivos + fines de semana) que se aplicarán al CPM y workload.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <CalendarsAdmin initialCalendars={calendars} />
        </div>
      </div>
    </div>
  )
}
