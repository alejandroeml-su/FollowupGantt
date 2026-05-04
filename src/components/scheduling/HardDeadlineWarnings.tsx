'use client'

import { AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { SerializableHardDeadlineCheck } from '@/lib/actions/leveling'

interface Props {
  data: SerializableHardDeadlineCheck
  /** Map opcional taskId → título humano para mostrar en lugar del id. */
  taskTitleById?: Record<string, string>
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('es', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function fmtSlack(slack: number) {
  if (slack < 0) {
    return `${Math.abs(slack)}d retrasada`
  }
  if (slack === 0) return 'Sin holgura'
  return `${slack}d de holgura`
}

/**
 * Vista de violaciones (rojo) y warnings (amarillo) de hardDeadlines.
 * Muestra estado vacío amistoso cuando no hay incidencias.
 */
export function HardDeadlineWarnings({ data, taskTitleById = {} }: Props) {
  const { violations, warnings, summary } = data

  if (violations.length === 0 && warnings.length === 0) {
    return (
      <div
        data-testid="hard-deadline-empty"
        className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"
      >
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
        <div>
          <p className="text-sm font-medium text-emerald-300">
            Sin violaciones
          </p>
          <p className="mt-1 text-xs text-emerald-200/70">
            {summary.totalWithDeadline} tarea(s) con vencimiento forzoso, todas
            con holgura suficiente.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="hard-deadline-warnings">
      {violations.length > 0 && (
        <Section
          tone="violation"
          icon={<AlertCircle className="h-5 w-5 text-red-400" />}
          title={`Vencimientos forzosos rotos (${violations.length})`}
          subtitle="Estas tareas no llegan a tiempo según CPM."
        >
          <ul className="divide-y divide-border/40">
            {violations.map((v) => (
              <li
                key={v.taskId}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="font-medium text-foreground">
                  {taskTitleById[v.taskId] ?? v.taskId}
                </span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>EF: {fmtDate(v.earlyFinish)}</span>
                  <span>·</span>
                  <span>HD: {fmtDate(v.hardDeadline)}</span>
                  <span className="rounded bg-red-500/20 px-2 py-0.5 font-medium text-red-300">
                    {fmtSlack(v.slackDays)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {warnings.length > 0 && (
        <Section
          tone="warning"
          icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
          title={`Vencimientos forzosos en riesgo (${warnings.length})`}
          subtitle="Menos de un día laborable de margen."
        >
          <ul className="divide-y divide-border/40">
            {warnings.map((w) => (
              <li
                key={w.taskId}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="font-medium text-foreground">
                  {taskTitleById[w.taskId] ?? w.taskId}
                </span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>EF: {fmtDate(w.earlyFinish)}</span>
                  <span>·</span>
                  <span>HD: {fmtDate(w.hardDeadline)}</span>
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 font-medium text-amber-300">
                    {fmtSlack(w.slackDays)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

interface SectionProps {
  tone: 'violation' | 'warning'
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
}

function Section({ tone, icon, title, subtitle, children }: SectionProps) {
  const border =
    tone === 'violation' ? 'border-red-500/40' : 'border-amber-500/40'
  const bg =
    tone === 'violation' ? 'bg-red-500/5' : 'bg-amber-500/5'
  return (
    <div className={`rounded-xl border ${border} ${bg}`}>
      <div className="flex items-start gap-3 border-b border-border/40 p-4">
        {icon}
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}
