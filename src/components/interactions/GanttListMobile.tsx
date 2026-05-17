'use client'

import { useMemo } from 'react'
import { CalendarDays, Clock, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import type { SerializedTask } from '@/lib/types'
import { useUIStore } from '@/lib/stores/ui'
import { TaskDrawer } from './TaskDrawer'
import { TaskDrawerContent } from './TaskDrawerContent'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'

/**
 * Vista vertical de tareas para mobile (P4-3).
 *
 * En `<sm` el Gantt timeline es inusable (40 px/día → 1200 px de ancho
 * mínimo); en lugar de forzar scroll horizontal con barras micro,
 * mostramos una lista densa con la información clave: título, proyecto,
 * fechas, progreso y estado.
 *
 * Wave R5E · Mobile-first refinements (2026-05-17) — Añadimos una
 * "mini-week-bar" por tarea: una barra horizontal compacta dividida
 * en N semanas (las visibles en el periodo) donde el rango de la
 * tarea pinta solo los buckets-semana que intersecta. Funciona como
 * un Gantt "colapsado por semana" con touch target adecuado (la
 * barra completa funge de tap target hacia el drawer).
 *
 * Tap en una fila abre el TaskDrawer (que es bottom-sheet en mobile,
 * Wave R5E).
 */
export function GanttListMobile({
  tasks,
  rangeLabel,
  rangeStart,
  rangeDays,
  projects = [],
  users = [],
  allTasks,
  currentUser = null,
}: {
  tasks: SerializedTask[]
  rangeLabel?: string
  /** ISO start del rango visible (default: derivado de las tareas). */
  rangeStart?: string
  /** Cantidad de días del rango visible (default: 30). */
  rangeDays?: number
  projects?: { id: string; name: string }[]
  users?: { id: string; name: string }[]
  allTasks?: SerializedTask[]
  /**
   * Wave P7 · C-DEBT-2 — Identidad del usuario actual para el drawer
   * (presence + edit locks). Forwardeada a `<TaskDrawerContent>`.
   */
  currentUser?: CurrentUserPresence | null
}) {
  const openDrawer = useUIStore((s) => s.openDrawer)
  const drawerTaskId = useUIStore((s) => s.drawerTaskId)

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const da = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER
      const db = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER
      return da - db
    })
  }, [tasks])

  const drawerTask = useMemo(
    () => sorted.find((t) => t.id === drawerTaskId) ?? null,
    [sorted, drawerTaskId],
  )

  // Wave R5E · Calcular weeks del rango visible. Default: usar el min/max
  // de fechas de las tareas si no se pasa rango explícito.
  const weeks = useMemo(() => {
    let start: Date | null = null
    let end: Date | null = null
    if (rangeStart) {
      start = new Date(rangeStart)
      const days = rangeDays ?? 30
      end = new Date(start.getTime() + days * 86_400_000)
    } else {
      for (const t of sorted) {
        if (t.startDate) {
          const d = new Date(t.startDate)
          if (!start || d < start) start = d
        }
        if (t.endDate) {
          const d = new Date(t.endDate)
          if (!end || d > end) end = d
        }
      }
    }
    if (!start || !end) return null
    // Cuadrar al lunes anterior para que las "semanas" sean ISO-week.
    const dow = start.getUTCDay() // 0=domingo, 1=lunes...
    const back = (dow + 6) % 7
    const aligned = new Date(start.getTime() - back * 86_400_000)
    const totalMs = end.getTime() - aligned.getTime()
    const weekCount = Math.max(1, Math.ceil(totalMs / (7 * 86_400_000)))
    // Cap a 8 semanas — más allá pierde resolución útil en mobile.
    const cappedWeeks = Math.min(weekCount, 8)
    return {
      start: aligned,
      end: new Date(aligned.getTime() + cappedWeeks * 7 * 86_400_000),
      count: cappedWeeks,
    }
  }, [sorted, rangeStart, rangeDays])

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <CalendarDays className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-foreground">Sin tareas en este periodo</p>
        {rangeLabel && (
          <p className="mt-1 text-xs text-muted-foreground capitalize">{rangeLabel}</p>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2 p-3" data-testid="gantt-list-mobile">
        {rangeLabel && (
          <div className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">
            {rangeLabel}
          </div>
        )}

        {/* Wave R5E · cabecera de semanas (etiquetas W1..Wn) para anclar
            las mini-barras de cada tarea. Sólo si tenemos rango. */}
        {weeks && weeks.count > 1 && (
          <div className="px-1 pt-1">
            <div className="grid gap-px text-[9px] uppercase tracking-wider text-muted-foreground" style={{ gridTemplateColumns: `repeat(${weeks.count}, minmax(0, 1fr))` }}>
              {Array.from({ length: weeks.count }).map((_, i) => (
                <span key={i} className="text-center">
                  S{i + 1}
                </span>
              ))}
            </div>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {sorted.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => openDrawer(t.id)}
                className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-3 text-left shadow-sm transition-colors hover:bg-accent active:bg-accent min-h-11"
                aria-label={`Abrir tarea ${t.title}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-medium text-foreground">
                    {t.mnemonic ? <span className="text-muted-foreground">{t.mnemonic} · </span> : null}
                    {t.title}
                  </span>
                  <StatusBadge status={t.status} />
                </div>

                {t.project?.name && (
                  <span className="truncate text-xs text-muted-foreground">{t.project.name}</span>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {(t.startDate || t.endDate) && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {formatRange(t.startDate, t.endDate)}
                    </span>
                  )}
                  {typeof t.progress === 'number' && (
                    <span className="flex items-center gap-1">
                      <span aria-hidden="true">·</span>
                      {Math.round(t.progress)}%
                    </span>
                  )}
                  {t.priority && t.priority !== 'NORMAL' && (
                    <span className="flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" aria-hidden="true" />
                      {t.priority.toLowerCase()}
                    </span>
                  )}
                </div>

                {/* Wave R5E · Mini-week-bar: una barra por tarea cubriendo
                    las semanas visibles del rango. Cada bucket pinta solo
                    si la tarea solapa esa semana. */}
                {weeks && t.startDate && t.endDate && (
                  <WeekBar
                    weeks={weeks}
                    taskStart={t.startDate}
                    taskEnd={t.endDate}
                  />
                )}

                {/* Progress bar — preserva el indicador original; las
                    week-bars cumplen otro propósito (cuándo, no cuánto). */}
                {typeof t.progress === 'number' && (
                  <div
                    className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={Math.round(t.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, t.progress))}%` }}
                    />
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Drawer compartido — bottom-sheet en mobile (Wave R5E). */}
      <TaskDrawer currentUser={currentUser}>
        {drawerTask ? (
          <TaskDrawerContent
            task={drawerTask}
            projects={projects}
            users={users}
            allTasks={allTasks ?? sorted}
            currentUser={currentUser}
          />
        ) : null}
      </TaskDrawer>
    </>
  )
}

/**
 * Wave R5E · WeekBar — renderiza N buckets-semana en grid; cada bucket
 * se pinta sólido cuando la tarea intersecta esa semana. Es la
 * representación visual "Gantt colapsado por semana" para mobile.
 */
function WeekBar({
  weeks,
  taskStart,
  taskEnd,
}: {
  weeks: { start: Date; end: Date; count: number }
  taskStart: string
  taskEnd: string
}) {
  const ts = new Date(taskStart).getTime()
  const te = new Date(taskEnd).getTime()
  if (isNaN(ts) || isNaN(te)) return null
  const weekMs = 7 * 86_400_000
  const baseMs = weeks.start.getTime()
  const cells = Array.from({ length: weeks.count }).map((_, i) => {
    const ws = baseMs + i * weekMs
    const we = ws + weekMs
    // overlap: max(start) < min(end)
    const overlap = Math.max(ts, ws) < Math.min(te, we)
    return overlap
  })
  return (
    <div
      className="mt-1 grid gap-px overflow-hidden rounded bg-muted"
      style={{ gridTemplateColumns: `repeat(${weeks.count}, minmax(0, 1fr))` }}
      aria-label="Distribución por semana"
    >
      {cells.map((on, i) => (
        <span
          key={i}
          className={clsx(
            'h-1.5',
            on ? 'bg-primary' : 'bg-transparent',
          )}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

function formatRange(start?: string | null, end?: string | null): string {
  const fmt = (iso?: string | null) => {
    if (!iso) return null
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  }
  const s = fmt(start)
  const e = fmt(end)
  if (s && e) return `${s} – ${e}`
  return s ?? e ?? ''
}

function StatusBadge({ status }: { status: string }) {
  const cls = clsx(
    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
    status === 'COMPLETED' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    status === 'IN_PROGRESS' && 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400',
    status === 'BLOCKED' && 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
    (status === 'TODO' || !status) && 'border-border bg-muted text-muted-foreground',
  )
  return <span className={cls}>{status?.replace('_', ' ').toLowerCase() || 'todo'}</span>
}
