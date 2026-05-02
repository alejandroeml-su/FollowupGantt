/**
 * Workload heatmap real (Ola P1.5).
 *
 * Sustituye el mock con `capacityLimit=5` por una vista temporal:
 *  - Eje X: próximas 12 semanas (lunes a domingo).
 *  - Eje Y: usuarios con `assignee` activo.
 *  - Celdas: utilización (planificadas / disponibles) coloreada por tier.
 *  - Click celda ⇒ drilldown con tasks que componen la carga.
 *
 * Usa el WorkCalendar default (si existe) para calcular días laborables;
 * si no hay calendar configurado, asume lun-vie 8h por defecto.
 */

import prisma from '@/lib/prisma'
import { TrendingUp } from 'lucide-react'
import {
  computeWorkloadHeatmap,
  DEFAULT_HEATMAP_WEEKS,
} from '@/lib/workload/compute'
import {
  DEFAULT_WORKDAYS_BITMASK,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'
import { WorkloadHeatmap } from '@/components/workload/WorkloadHeatmap'

export const dynamic = 'force-dynamic'

interface DefaultCalendar extends WorkCalendarLike {
  workdayHours: number
}

async function loadDefaultCalendar(): Promise<DefaultCalendar> {
  // Cargar el WorkCalendar default si existe; fallback a lun-vie 8h.
  try {
    const cal = await (prisma as unknown as {
      workCalendar: {
        findFirst: (a: unknown) => Promise<
          | {
              workdays: number
              workdayHours: unknown
              holidays: Array<{ date: Date; recurring: boolean }>
            }
          | null
        >
      }
    }).workCalendar.findFirst({
      where: { isDefault: true },
      include: {
        holidays: { select: { date: true, recurring: true } },
      },
    })
    if (cal) {
      return {
        workdays: cal.workdays,
        holidays: cal.holidays,
        workdayHours:
          typeof cal.workdayHours === 'object' && cal.workdayHours !== null
            ? Number(cal.workdayHours.toString())
            : Number(cal.workdayHours),
      }
    }
  } catch {
    /* migración pendiente */
  }
  return {
    workdays: DEFAULT_WORKDAYS_BITMASK,
    holidays: [],
    workdayHours: 8,
  }
}

export default async function WorkloadPage() {
  const calendar = await loadDefaultCalendar()

  const usersDb = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      tasks: {
        where: {
          status: { not: 'DONE' },
          archivedAt: null,
          startDate: { not: null },
          endDate: { not: null },
        },
        select: {
          id: true,
          title: true,
          startDate: true,
          endDate: true,
          project: { select: { name: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  const users = usersDb
    .filter((u) => u.tasks.length > 0)
    .map((u) => ({ id: u.id, name: u.name }))

  const tasks = usersDb.flatMap((u) =>
    u.tasks
      .filter((t) => t.startDate && t.endDate)
      .map((t) => ({
        id: t.id,
        title: t.title,
        projectName: t.project?.name,
        assigneeId: u.id,
        startDate: t.startDate as Date,
        endDate: t.endDate as Date,
      })),
  )

  const heatmap = computeWorkloadHeatmap({
    tasks,
    users,
    calendar,
    workdayHours: calendar.workdayHours,
    weeksCount: DEFAULT_HEATMAP_WEEKS,
  })

  // Serializar las fechas para pasar al client component
  const serialized = {
    weeks: heatmap.weeks.map((d) => d.toISOString()),
    users: heatmap.users,
    cells: heatmap.cells.map((c) => ({
      weekStart: c.weekStart.toISOString(),
      userId: c.userId,
      plannedHours: c.plannedHours,
      availableHours: c.availableHours,
      utilization: c.utilization,
      tasks: c.tasks,
    })),
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Cargas de trabajo
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Heatmap de utilización por recurso (próximas {DEFAULT_HEATMAP_WEEKS}{' '}
            semanas) — calendario laboral aplicado
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/settings/calendars"
            className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-foreground/90 hover:bg-secondary/80 transition-colors border border-border"
          >
            <TrendingUp className="h-4 w-4 text-indigo-400" />
            Configurar calendario
          </a>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[1400px]">
          {users.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
              No hay tareas activas asignadas a ningún usuario.
            </div>
          ) : (
            <WorkloadHeatmap data={serialized} />
          )}
        </div>
      </div>
    </div>
  )
}
