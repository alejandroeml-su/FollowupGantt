'use client'

/**
 * Ola P5 · Equipo P5-4 · AI Insights — Badge embebible de riesgo de retraso.
 *
 * Componente puramente presentacional: recibe `level` + `score` (+ factores
 * opcionales para tooltip). Sin fetch propio, sin estado: el padre decide
 * cuándo y cómo renderizarlo.
 *
 * Uso:
 *   <RiskBadge level="high" score={0.78} factors={["Progreso bajo", "Vencida"]} />
 *
 * Edwin (o el equipo dueño del componente) puede embeberlo en `TaskCard`,
 * `ListTaskRow`, drawer y dashboards sin acoplarlo al server action.
 */

import { clsx } from 'clsx'

export type RiskBadgeLevel = 'low' | 'medium' | 'high'

interface Props {
  level: RiskBadgeLevel
  score: number
  factors?: string[]
  /** Si true, el badge ocupa solo el dot + level abreviado (para listas densas). */
  compact?: boolean
  className?: string
}

const STYLES: Record<RiskBadgeLevel, { container: string; dot: string; label: string }> = {
  low: {
    container:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
    dot: 'bg-emerald-500',
    label: 'Bajo',
  },
  medium: {
    container:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    dot: 'bg-amber-500',
    label: 'Medio',
  },
  high: {
    container:
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
    dot: 'bg-red-500',
    label: 'Alto',
  },
}

export function RiskBadge({
  level,
  score,
  factors,
  compact = false,
  className,
}: Props): React.JSX.Element {
  const style = STYLES[level]
  const tooltip = (factors ?? []).join(' · ') || `Score ${(score * 100).toFixed(0)}%`
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)

  return (
    <span
      title={`Riesgo de retraso · ${style.label} (${pct}%) — ${tooltip}`}
      aria-label={`Riesgo de retraso ${style.label}, score ${pct}%`}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        style.container,
        className,
      )}
    >
      <span className={clsx('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden />
      {compact ? (
        <span>{style.label}</span>
      ) : (
        <span>
          Riesgo {style.label} · {pct}%
        </span>
      )}
    </span>
  )
}
