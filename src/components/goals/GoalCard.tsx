'use client'

/**
 * Ola P2 · Equipo P2-4 — Tarjeta de Objective con resultados clave
 * (Key Results) colapsables.
 *
 * Renderiza:
 *   - Header: title, owner, badge de status, ciclo.
 *   - Progress bar agregada del Goal.
 *   - Lista de KRs con su propia barra y unidad. Tareas vinculadas en
 *     contador (no se expande aquí: el detalle vive en el dialog
 *     LinkTaskToKRDialog accesible desde el botón "Vincular tarea").
 *
 * Strings visibles ya están en español (Ola P1). El estado se muestra con
 * etiquetas legibles "On track" / "En riesgo" / "Fuera de ruta".
 */

import { useState } from 'react'
import { ChevronDown, Target, TrendingUp, AlertTriangle, AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import type { GoalStatus, KeyResultMetric } from '@prisma/client'
import type { SerializedGoal, SerializedKeyResult } from '@/lib/actions/goals'

type Props = {
  goal: SerializedGoal
  /**
   * Callback opcional cuando el usuario pulsa "Vincular tarea" sobre un KR
   * de tipo TASKS_COMPLETED. El padre debe abrir el dialog correspondiente.
   */
  onLinkTaskRequest?: (krId: string) => void
}

const STATUS_LABEL: Record<GoalStatus, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'En riesgo',
  OFF_TRACK: 'Fuera de ruta',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
}

const STATUS_STYLE: Record<GoalStatus, string> = {
  ON_TRACK: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  AT_RISK: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  OFF_TRACK: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
  COMPLETED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
}

const STATUS_ICON: Record<GoalStatus, typeof Target> = {
  ON_TRACK: TrendingUp,
  AT_RISK: AlertTriangle,
  OFF_TRACK: AlertCircle,
  COMPLETED: CheckCircle2,
  CANCELLED: XCircle,
}

const METRIC_LABEL: Record<KeyResultMetric, string> = {
  PERCENT: '%',
  NUMERIC: 'numérico',
  BOOLEAN: 'sí/no',
  TASKS_COMPLETED: 'tareas',
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div className="relative h-2 w-full overflow-hidden rounded bg-muted">
      <div
        className="h-full rounded bg-primary transition-all"
        style={{ width: `${pct}%` }}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        role="progressbar"
      />
    </div>
  )
}

function KeyResultRow({
  kr,
  onLinkTaskRequest,
}: {
  kr: SerializedKeyResult
  onLinkTaskRequest?: (krId: string) => void
}) {
  const isTasksMetric = kr.metric === 'TASKS_COMPLETED'
  const valueLabel =
    kr.metric === 'BOOLEAN'
      ? kr.currentValue >= 1
        ? 'Completado'
        : 'Pendiente'
      : `${formatNumber(kr.currentValue)}${kr.unit ? ` ${kr.unit}` : ''} / ${formatNumber(kr.targetValue)}${kr.unit ? ` ${kr.unit}` : ''}`

  return (
    <li className="space-y-1 rounded border border-border bg-card/40 px-3 py-2" data-testid="kr-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{kr.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {METRIC_LABEL[kr.metric]} · {valueLabel}
            {isTasksMetric && (
              <> · {kr.linkedTaskCount} {kr.linkedTaskCount === 1 ? 'tarea vinculada' : 'tareas vinculadas'}</>
            )}
          </p>
        </div>
        {isTasksMetric && onLinkTaskRequest && (
          <button
            type="button"
            onClick={() => onLinkTaskRequest(kr.id)}
            className="shrink-0 rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
            data-testid="kr-link-task-btn"
          >
            Vincular tarea
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {Math.round(kr.progress)}%
        </span>
        <div className="flex-1">
          <ProgressBar value={kr.progress} />
        </div>
      </div>
    </li>
  )
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}

export function GoalCard({ goal, onLinkTaskRequest }: Props) {
  const [open, setOpen] = useState<boolean>(true)
  const StatusIcon = STATUS_ICON[goal.status]

  return (
    <article
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
      data-testid="goal-card"
      data-goal-id={goal.id}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary shrink-0" aria-hidden />
            <h3 className="truncate text-base font-semibold text-foreground">{goal.title}</h3>
          </div>
          {goal.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {goal.description}
            </p>
          ) : null}
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{goal.ownerName}</span>
            {goal.projectName ? <> · {goal.projectName}</> : null}
            {' · '}
            <span className="font-mono">{goal.cycle}</span>
          </p>
        </div>

        <span
          className={[
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
            STATUS_STYLE[goal.status],
          ].join(' ')}
          data-testid="goal-status-badge"
        >
          <StatusIcon className="h-3 w-3" aria-hidden />
          {STATUS_LABEL[goal.status]}
        </span>
      </header>

      <div className="mt-3 flex items-center gap-2">
        <span className="w-12 text-right text-xs font-medium tabular-nums text-foreground">
          {Math.round(goal.progress)}%
        </span>
        <div className="flex-1">
          <ProgressBar value={goal.progress} />
        </div>
      </div>

      <div className="mt-3 border-t border-border pt-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
          data-testid="goal-toggle-krs"
          aria-expanded={open}
        >
          <span>
            Resultados clave ({goal.keyResults.length})
          </span>
          <ChevronDown
            className={[
              'h-4 w-4 transition-transform',
              open ? 'rotate-180' : '',
            ].join(' ')}
            aria-hidden
          />
        </button>

        {open && (
          <ul className="mt-2 space-y-2" data-testid="goal-krs-list">
            {goal.keyResults.length === 0 ? (
              <li className="rounded border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                Aún no hay resultados clave. Añade el primero.
              </li>
            ) : (
              goal.keyResults.map((kr) => (
                <KeyResultRow
                  key={kr.id}
                  kr={kr}
                  onLinkTaskRequest={onLinkTaskRequest}
                />
              ))
            )}
          </ul>
        )}
      </div>
    </article>
  )
}
