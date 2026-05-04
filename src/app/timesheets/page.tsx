/**
 * Ola P1 · Equipo 4 — Vista semanal de timesheets por usuario.
 *
 * Server component: lee la lista de usuarios y delega al client wrapper
 * (`TimesheetView`) la selección de usuario/semana, la expansión de
 * días y el export Excel. Para el primer load usa el primer usuario
 * con name (mismo placeholder de "current user" que el resto del
 * sistema mientras no haya auth real).
 */

import { Clock } from 'lucide-react'
import prisma from '@/lib/prisma'
import { TimesheetView } from '@/components/time-tracking/TimesheetView'

export const dynamic = 'force-dynamic'

export default async function TimesheetsPage() {
  const users = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-subtle/50 px-8">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <Clock className="h-5 w-5 text-emerald-400" />
            Timesheet
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Registro semanal de tiempo · Total semana por usuario · Export Excel
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-[1400px]">
          <TimesheetView users={users} />
        </div>
      </div>
    </div>
  )
}
