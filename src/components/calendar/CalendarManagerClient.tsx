'use client'

/**
 * Wave P10 (HU-10.2 · BETA-1.4) — Calendar manager UI.
 *
 * MVP funcional con dos secciones:
 *  - Holidays del WorkCalendar del proyecto + import bulk MX
 *  - Lista de availabilities del equipo (próximos 3 meses, read-only en MVP)
 *
 * La edición fina (forms add/edit por holiday y por availability) queda
 * como follow-up R2 si hay tiempo en Wave P10.
 */

import { useState, useTransition } from 'react'
import { Calendar, Download, Loader2, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { bulkImportHolidays } from '@/lib/actions/availability'
import { buildMxAllHolidayRows } from '@/lib/calendar/mx-presets'
import { toast } from '@/components/interactions/Toaster'

type HolidayDto = {
  id: string
  date: string
  name: string
  recurring: boolean
}

type AvailabilityDto = {
  id: string
  startDate: string
  endDate: string
  reason: 'VACATION' | 'SICK' | 'TRAINING' | 'REDUCED_HOURS' | 'OTHER'
  reducedHoursPercent: number | null
  notes: string | null
}

type TeamMemberDto = {
  id: string
  name: string
  email: string
  availabilities: AvailabilityDto[]
}

type CalendarDto = {
  id: string
  name: string
  workdays: number
  workdayHours: number
  holidays: HolidayDto[]
}

type Props = {
  projectId: string
  calendar: CalendarDto | null
  team: TeamMemberDto[]
}

const REASON_LABELS: Record<AvailabilityDto['reason'], string> = {
  VACATION: 'Vacaciones',
  SICK: 'Enfermedad',
  TRAINING: 'Capacitación',
  REDUCED_HOURS: 'Jornada reducida',
  OTHER: 'Otro',
}

const REASON_COLOR: Record<AvailabilityDto['reason'], string> = {
  VACATION: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  SICK: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  TRAINING: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  REDUCED_HOURS: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  OTHER: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatDate(startIso)
  return `${formatDate(startIso)} → ${formatDate(endIso)}`
}

export function CalendarManagerClient({ projectId, calendar, team }: Props) {
  void projectId
  const [isPending, startTransition] = useTransition()
  const [year, setYear] = useState(new Date().getUTCFullYear())
  const router = useRouter()

  const handleImportMx = () => {
    if (!calendar) {
      toast.error(
        'El proyecto no tiene WorkCalendar asignado. Crea uno en Settings primero.',
      )
      return
    }
    startTransition(async () => {
      try {
        const rows = buildMxAllHolidayRows(year)
        const result = await bulkImportHolidays({
          calendarId: calendar.id,
          rows,
        })
        toast.success(
          `Importados ${result.created} nuevos · ${result.updated} actualizados (MX ${year})`,
        )
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al importar')
      }
    })
  }

  const teamWithBlocks = team.filter((u) => u.availabilities.length > 0)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* ── Sección Holidays ── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
              <Calendar className="h-4 w-4 text-indigo-400" />
              Holidays del calendario
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {calendar ? (
                <>
                  Calendario asignado:{' '}
                  <span className="font-medium text-foreground">
                    {calendar.name}
                  </span>{' '}
                  · {calendar.workdayHours}h por jornada
                </>
              ) : (
                'Sin WorkCalendar asignado al proyecto. Asigna uno en Settings → Calendarios.'
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none"
              disabled={isPending || !calendar}
            >
              {[2025, 2026, 2027, 2028].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleImportMx}
              disabled={isPending || !calendar}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Importar holidays MX {year}
            </button>
          </div>
        </div>

        {calendar && calendar.holidays.length > 0 ? (
          <ul className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {calendar.holidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between rounded-md border border-border bg-input/40 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {h.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDate(h.date)}
                    {h.recurring && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                        <Sparkles className="h-2.5 w-2.5" /> recurrente
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : calendar ? (
          <p className="mt-4 rounded-md border border-dashed border-border bg-input/20 px-4 py-6 text-center text-sm text-muted-foreground">
            Sin holidays cargados. Usa el botón de import o agrega uno desde
            Settings → Calendarios.
          </p>
        ) : null}
      </section>

      {/* ── Sección Availabilities ── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-base font-semibold text-foreground">
          Agenda del equipo · próximos 3 meses
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Bloques de no-disponibilidad reportados por miembros del equipo.
          Afectan la capacidad real del sprint y el CPM. (Edición avanzada en
          R2.)
        </p>

        {teamWithBlocks.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border bg-input/20 px-4 py-6 text-center text-sm text-muted-foreground">
            Sin bloques registrados en los próximos 3 meses.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {teamWithBlocks.map((u) => (
              <li
                key={u.id}
                className="rounded-md border border-border bg-input/40 p-3"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {u.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {u.availabilities.length} bloque
                    {u.availabilities.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {u.availabilities.map((a) => (
                    <li
                      key={a.id}
                      className={`flex items-center justify-between rounded border px-2 py-1.5 text-xs ${REASON_COLOR[a.reason]}`}
                    >
                      <div>
                        <span className="font-medium">
                          {REASON_LABELS[a.reason]}
                        </span>
                        {a.reducedHoursPercent != null && (
                          <span className="ml-1 opacity-80">
                            ({a.reducedHoursPercent}%)
                          </span>
                        )}
                        {a.notes && (
                          <span className="ml-2 opacity-70">— {a.notes}</span>
                        )}
                      </div>
                      <span className="opacity-80">
                        {formatRange(a.startDate, a.endDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
