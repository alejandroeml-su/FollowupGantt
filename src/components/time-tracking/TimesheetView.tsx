'use client'

/**
 * Vista interactiva del timesheet semanal. Cliente porque maneja:
 *   - Selector de usuario.
 *   - Navegación de semana (anterior, siguiente, semana actual).
 *   - Expansión de un día → detalle de entries.
 *   - Botón de export Excel.
 *
 * Datos cargados con `getWeekTimesheet` (server action) en
 * `useEffect`. No persistimos preferencia de usuario seleccionado:
 * para el flujo actual el caller arranca con el primer user (sin
 * sesión real) y puede cambiarlo manualmente.
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet } from 'lucide-react'
import { toast } from '@/components/interactions/Toaster'
import {
  getWeekTimesheet,
  type SerializedTimeEntry,
} from '@/lib/actions/time-entries'
import { exportWeekTimesheet } from '@/lib/actions/timesheet-export'

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

type Props = {
  users: Array<{ id: string; name: string }>
}

/**
 * Devuelve el lunes 00:00:00 (hora local) de la semana de `date`.
 * Usamos lunes como inicio de semana (convención latinoamericana del
 * proyecto) — distinto al estándar US-Sunday.
 */
function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  // getDay(): 0=Domingo, 1=Lunes, ..., 6=Sábado.
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day // empuja al lunes anterior
  d.setDate(d.getDate() + diff)
  return d
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })
}

function fmtDuration(minutes: number): string {
  if (minutes <= 0) return '0h'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function fmtCost(cost: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cost)
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TimesheetView({ users }: Props) {
  const [userId, setUserId] = useState<string>(users[0]?.id ?? '')
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))
  const [data, setData] = useState<{
    entries: SerializedTimeEntry[]
    totalMinutes: number
    totalCost: number
    perDay: Array<{ date: string; minutes: number; cost: number }>
  } | null>(null)
  const [expandedDay, setExpandedDay] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, startExport] = useTransition()

  const userName = useMemo(
    () => users.find((u) => u.id === userId)?.name ?? '',
    [users, userId],
  )

  useEffect(() => {
    if (!userId) {
      // Resetear data en sub-tick para no caer en el anti-pattern
      // "setState sincrónico dentro de useEffect".
      const timeoutId = setTimeout(() => setData(null), 0)
      return () => clearTimeout(timeoutId)
    }
    let cancelled = false
    // setLoading inside async callback (no synchronous setState in effect).
    Promise.resolve()
      .then(() => {
        if (cancelled) return
        setLoading(true)
        return getWeekTimesheet(userId, weekStart.toISOString())
      })
      .then((result) => {
        if (!cancelled && result) setData(result)
      })
      .catch((e) => {
        if (!cancelled) toast.error((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, weekStart])

  function shiftWeek(deltaDays: number) {
    const next = new Date(weekStart)
    next.setDate(next.getDate() + deltaDays)
    setWeekStart(startOfWeek(next))
    setExpandedDay(null)
  }

  function handleToday() {
    setWeekStart(startOfWeek(new Date()))
    setExpandedDay(null)
  }

  function handleExport() {
    if (!userId || !userName) return
    startExport(async () => {
      try {
        const { filename, base64 } = await exportWeekTimesheet({
          userId,
          userName,
          weekStart: weekStart.toISOString(),
        })
        // Base64 → Blob → descarga.
        const bytes = atob(base64)
        const bin = new Uint8Array(bytes.length)
        for (let i = 0; i < bytes.length; i++) bin[i] = bytes.charCodeAt(i)
        const blob = new Blob([bin], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        toast.success('Excel exportado')
      } catch (e) {
        toast.error((e as Error).message)
      }
    })
  }

  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/60 p-4 shadow-sm">
        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Usuario</span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftWeek(-7)}
            aria-label="Semana anterior"
            className="rounded-md border border-border bg-card px-2 py-1 text-foreground hover:bg-secondary"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => shiftWeek(7)}
            aria-label="Semana siguiente"
            className="rounded-md border border-border bg-card px-2 py-1 text-foreground hover:bg-secondary"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <span className="text-xs text-muted-foreground">
          {fmtDate(weekStart)} — {fmtDate(weekEnd)}
        </span>

        <div className="ml-auto flex items-center gap-3">
          {data ? (
            <>
              <span className="text-xs text-muted-foreground">
                Total semana:{' '}
                <span className="font-semibold text-foreground">
                  {fmtDuration(data.totalMinutes)}
                </span>{' '}
                · {fmtCost(data.totalCost)}
              </span>
            </>
          ) : null}
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !data || !userId}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            data-testid="export-timesheet"
          >
            {exporting ? (
              <Download className="h-3.5 w-3.5 animate-pulse" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Día</th>
              <th className="px-4 py-2 text-left">Fecha</th>
              <th className="px-4 py-2 text-right">Horas</th>
              <th className="px-4 py-2 text-right">Costo</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {DAY_LABELS.map((label, i) => {
              const day = new Date(weekStart.getTime() + i * 86_400_000)
              const dayData = data?.perDay[i] ?? { date: day.toISOString(), minutes: 0, cost: 0 }
              const isExpanded = expandedDay === i
              const dayEntries = data?.entries.filter((e) => {
                const t = new Date(e.startedAt).getTime()
                const dayStart = day.getTime()
                return t >= dayStart && t < dayStart + 86_400_000
              }) ?? []
              return (
                <>
                  <tr
                    key={`row-${i}`}
                    className="cursor-pointer border-t border-border hover:bg-secondary/30"
                    onClick={() => setExpandedDay(isExpanded ? null : i)}
                  >
                    <td className="px-4 py-2 font-medium text-foreground">{label}</td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtDay(day)}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {fmtDuration(dayData.minutes)}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {fmtCost(dayData.cost)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                      {dayEntries.length > 0 ? (isExpanded ? 'Ocultar' : 'Ver') : ''}
                    </td>
                  </tr>
                  {isExpanded && dayEntries.length > 0 ? (
                    <tr key={`expand-${i}`} className="bg-secondary/20">
                      <td colSpan={5} className="px-4 py-3">
                        <ul className="flex flex-col gap-1.5">
                          {dayEntries.map((e) => (
                            <li
                              key={e.id}
                              className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-1.5 text-xs"
                            >
                              <span className="font-mono text-muted-foreground">
                                {fmtTime(e.startedAt)} →{' '}
                                {e.endedAt ? fmtTime(e.endedAt) : '⏱'}
                              </span>
                              <span className="flex-1 text-foreground">
                                {e.description || (
                                  <span className="text-muted-foreground italic">
                                    Sin descripción
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-muted-foreground">
                                {fmtDuration(e.durationMinutes)}
                              </span>
                              <span className="font-mono text-muted-foreground">
                                {fmtCost(e.cost ?? 0)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-secondary/40 text-sm font-semibold">
              <td className="px-4 py-2" colSpan={2}>
                Total semana
              </td>
              <td className="px-4 py-2 text-right font-mono">
                {fmtDuration(data?.totalMinutes ?? 0)}
              </td>
              <td className="px-4 py-2 text-right">
                {fmtCost(data?.totalCost ?? 0)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {loading ? (
        <p className="text-center text-xs text-muted-foreground">Cargando…</p>
      ) : null}
    </div>
  )
}
