'use client'

/**
 * US-5.1 · Box View · UserBox — tarjeta individual por miembro.
 *
 * Pinta:
 *  - Avatar + nombre + rol
 *  - Sprint activo y Epic activa (chips)
 *  - Métricas: activas, DONE en sprint, atrasadas, progreso promedio
 *  - Mini-barra capacidad (horas asignadas / capacidad semanal)
 *  - Top-5 tareas con badge de estado y prioridad
 *  - Click en card → /list?assigneeId=<id> (lista filtrada por persona)
 *  - Click en tarea individual → mismo destino con anchor a la tarea
 */

import Link from 'next/link'
import { clsx } from 'clsx'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Flag,
  Rocket,
  Sparkles as SparklesIcon,
  User as UserIcon,
} from 'lucide-react'
import {
  computeBoxMetrics,
  pickTopTasks,
  type BoxTaskInput,
} from '@/lib/box-view/metrics'

export type UserBoxTaskView = BoxTaskInput & {
  projectId: string | null
  epicId: string | null
  epicName: string | null
  epicColor: string | null
}

type UserBoxUser = {
  id: string
  name: string
  email: string
  image: string | null
  role: string | null
  activeSprint: {
    id: string
    name: string
    startDate: string
    endDate: string
  } | null
  topEpic: {
    id: string
    name: string
    color: string
  } | null
}

type Props = {
  user: UserBoxUser
  tasks: UserBoxTaskView[]
}

const STATUS_DOT: Record<UserBoxTaskView['status'], string> = {
  TODO: 'bg-muted-foreground/50',
  IN_PROGRESS: 'bg-indigo-400',
  REVIEW: 'bg-amber-400',
  DONE: 'bg-emerald-500',
}

const STATUS_LABEL: Record<UserBoxTaskView['status'], string> = {
  TODO: 'Por hacer',
  IN_PROGRESS: 'En curso',
  REVIEW: 'Revisión',
  DONE: 'Hecho',
}

const PRIORITY_COLOR: Record<UserBoxTaskView['priority'], string> = {
  CRITICAL: 'text-rose-400',
  HIGH: 'text-amber-400',
  MEDIUM: 'text-indigo-400',
  LOW: 'text-muted-foreground',
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function utilizationTone(util: number): {
  bar: string
  label: string
  hint: string
} {
  if (util >= 1.1) {
    return {
      bar: 'bg-rose-500',
      label: 'text-rose-300',
      hint: 'Sobreasignado',
    }
  }
  if (util >= 0.85) {
    return {
      bar: 'bg-amber-400',
      label: 'text-amber-300',
      hint: 'Carga alta',
    }
  }
  if (util >= 0.4) {
    return {
      bar: 'bg-emerald-500',
      label: 'text-emerald-300',
      hint: 'Carga saludable',
    }
  }
  return {
    bar: 'bg-indigo-400',
    label: 'text-indigo-300',
    hint: 'Disponible',
  }
}

export function UserBox({ user, tasks }: Props) {
  // 2026-05-16 · US-5.1 — `now` se captura una sola vez por render (React
  // rules-of-purity prohibe llamar `Date.now()` dentro del JSX). Una card
  // se monta y desmonta con datos del Server Component, así que un
  // snapshot por render es suficiente para resaltar "atrasada".
  const now = new Date()
  const nowMs = now.getTime()

  const metrics = computeBoxMetrics({
    tasks,
    activeSprintId: user.activeSprint?.id ?? null,
    now,
  })

  const top = pickTopTasks(tasks, now)
  const utilPct = Math.min(metrics.utilization, 1.5) * 100
  const tone = utilizationTone(metrics.utilization)

  // Click en cualquier zona "no-link" abre la lista filtrada por
  // persona. Implementado como overlay Link para que el card sea
  // 100% accesible por teclado.
  const filteredListHref = `/list?assigneeId=${encodeURIComponent(user.id)}`

  return (
    <article
      data-testid={`user-box-${user.id}`}
      className="relative flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-indigo-500/40"
    >
      {/* Overlay link a /list filtrado — z-0, los enlaces internos llevan z-10 */}
      <Link
        href={filteredListHref}
        aria-label={`Abrir tareas asignadas a ${user.name}`}
        className="absolute inset-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
      />

      {/* ── Header: avatar + nombre + rol ──────────────────────── */}
      <header className="relative z-10 pointer-events-none flex items-center gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-sm font-bold text-indigo-300"
          aria-hidden
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              className="h-11 w-11 rounded-full object-cover"
            />
          ) : (
            initials(user.name)
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {user.name}
          </p>
          <p className="truncate text-xs text-muted-foreground flex items-center gap-1">
            <UserIcon className="h-3 w-3" aria-hidden />
            {user.role ?? 'Colaborador'}
          </p>
        </div>
      </header>

      {/* ── Chips: sprint + epic ───────────────────────────────── */}
      {(user.activeSprint || user.topEpic) && (
        <div className="relative z-10 pointer-events-none mt-3 flex flex-wrap gap-1.5">
          {user.activeSprint && (
            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
              <Rocket className="h-3 w-3" aria-hidden />
              {user.activeSprint.name}
            </span>
          )}
          {user.topEpic && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: `${user.topEpic.color}22`,
                color: user.topEpic.color,
              }}
            >
              <SparklesIcon className="h-3 w-3" aria-hidden />
              {user.topEpic.name}
            </span>
          )}
        </div>
      )}

      {/* ── Métricas ───────────────────────────────────────────── */}
      <dl className="relative z-10 pointer-events-none mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Activas
          </dt>
          <dd className="text-base font-semibold text-foreground">
            {metrics.activeCount}
          </dd>
        </div>
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            DONE
          </dt>
          <dd className="text-base font-semibold text-emerald-300">
            {metrics.doneThisSprintCount}
          </dd>
        </div>
        <div
          className={clsx(
            'rounded-md border p-2',
            metrics.overdueCount > 0
              ? 'border-rose-500/40 bg-rose-500/10'
              : 'border-border/60 bg-background/40',
          )}
        >
          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Atrasadas
          </dt>
          <dd
            className={clsx(
              'text-base font-semibold',
              metrics.overdueCount > 0
                ? 'text-rose-300'
                : 'text-foreground',
            )}
          >
            {metrics.overdueCount}
          </dd>
        </div>
      </dl>

      {/* ── Progreso promedio + capacidad ──────────────────────── */}
      <div className="relative z-10 pointer-events-none mt-3 space-y-2">
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Progreso promedio</span>
            <span className="font-medium text-foreground">
              {metrics.averageProgress == null
                ? '—'
                : `${Math.round(metrics.averageProgress)}%`}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(metrics.averageProgress ?? 0)}
              className="h-full bg-indigo-400 transition-[width] duration-300"
              style={{ width: `${metrics.averageProgress ?? 0}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Capacidad semanal</span>
            <span className={clsx('font-medium', tone.label)}>
              {Math.round(metrics.assignedHours)}h / {metrics.capacityHours}h
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({tone.hint})
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              role="progressbar"
              aria-label={`Utilización ${Math.round(metrics.utilization * 100)}%`}
              aria-valuemin={0}
              aria-valuemax={150}
              aria-valuenow={Math.round(metrics.utilization * 100)}
              className={clsx('h-full transition-[width] duration-300', tone.bar)}
              style={{ width: `${Math.min(utilPct, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Top-5 tareas ───────────────────────────────────────── */}
      <ul className="relative z-10 mt-3 space-y-1.5">
        {top.length === 0 ? (
          <li className="pointer-events-none rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-[11px] text-muted-foreground">
            Sin tareas activas en este filtro.
          </li>
        ) : (
          top.map((t) => {
            const overdue =
              t.endDate != null &&
              t.status !== 'DONE' &&
              Date.parse(t.endDate) < nowMs
            return (
              <li key={t.id}>
                <Link
                  href={`/list?assigneeId=${encodeURIComponent(user.id)}#task-${encodeURIComponent(t.id)}`}
                  className="group flex items-center gap-2 rounded-md border border-transparent bg-background/40 px-2 py-1.5 text-xs transition-colors hover:border-indigo-500/40 hover:bg-background/70"
                >
                  <span
                    aria-hidden
                    className={clsx(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      STATUS_DOT[t.status],
                    )}
                    title={STATUS_LABEL[t.status]}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground group-hover:text-indigo-300">
                    {t.title}
                  </span>
                  {overdue && (
                    <AlertTriangle
                      className="h-3 w-3 shrink-0 text-rose-400"
                      aria-label="Tarea atrasada"
                    />
                  )}
                  <Flag
                    className={clsx(
                      'h-3 w-3 shrink-0',
                      PRIORITY_COLOR[t.priority],
                    )}
                    aria-label={`Prioridad ${t.priority.toLowerCase()}`}
                  />
                </Link>
              </li>
            )
          })
        )}
      </ul>

      {/* ── Footer hint ───────────────────────────────────────── */}
      <footer className="relative z-10 pointer-events-none mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {metrics.activeCount > 0 ? (
            <Clock className="h-3 w-3" aria-hidden />
          ) : metrics.overdueCount > 0 ? (
            <AlertTriangle className="h-3 w-3 text-rose-400" aria-hidden />
          ) : (
            <CircleDashed className="h-3 w-3" aria-hidden />
          )}
          {tasks.length} tareas totales
        </span>
        {metrics.doneThisSprintCount > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {metrics.doneThisSprintCount} done sprint
          </span>
        )}
      </footer>
    </article>
  )
}
