'use client'

/**
 * Ola P8 · Equipo P8-3 · Cost Management — Tarjeta EAC Forecast.
 *
 * Visualiza los KPIs PMI del proyecto: BAC, EV, AC, CPI, EAC ajustado por
 * velocity y VAC. Sirve como vista ejecutiva en el dashboard de costos
 * y en `/expenses?projectId=...`.
 *
 * El estado de "salud" se infiere de VAC:
 *   - VAC >= 0  → 'on-budget' (verde)
 *   - VAC > -10% BAC → 'at-risk' (ámbar)
 *   - VAC <= -10% BAC → 'over-budget' (rojo)
 */

import { TrendingDown, TrendingUp, Target } from 'lucide-react'
import type { ProjectForecastResult } from '@/lib/actions/budgets'

export type EACForecastCardProps = {
  forecast: ProjectForecastResult
}

function formatUsd(value: number): string {
  if (!isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function classifyHealth(forecast: ProjectForecastResult): 'on-budget' | 'at-risk' | 'over-budget' {
  if (forecast.bac <= 0) return 'at-risk'
  const ratio = forecast.vac / forecast.bac
  if (ratio >= 0) return 'on-budget'
  if (ratio > -0.1) return 'at-risk'
  return 'over-budget'
}

const HEALTH_STYLE: Record<ReturnType<typeof classifyHealth>, string> = {
  'on-budget': 'border-emerald-500/30 bg-emerald-500/5',
  'at-risk': 'border-amber-500/30 bg-amber-500/5',
  'over-budget': 'border-red-500/30 bg-red-500/5',
}

const HEALTH_LABEL: Record<ReturnType<typeof classifyHealth>, string> = {
  'on-budget': 'En presupuesto',
  'at-risk': 'En riesgo',
  'over-budget': 'Sobre presupuesto',
}

export function EACForecastCard(props: EACForecastCardProps) {
  const { forecast } = props
  const health = classifyHealth(forecast)
  const TrendIcon = forecast.vac >= 0 ? TrendingUp : TrendingDown

  return (
    <article
      className={`rounded border ${HEALTH_STYLE[health]} p-4`}
      aria-label={`Forecast EAC ${forecast.projectName}`}
    >
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold">{forecast.projectName}</h3>
        </div>
        <span className="text-xs font-medium tabular-nums">{HEALTH_LABEL[health]}</span>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">BAC</dt>
          <dd className="font-medium tabular-nums">{formatUsd(forecast.bac)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">EV</dt>
          <dd className="font-medium tabular-nums">{formatUsd(forecast.ev)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">AC</dt>
          <dd className="font-medium tabular-nums">{formatUsd(forecast.ac)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">CPI</dt>
          <dd className="font-medium tabular-nums">
            {isFinite(forecast.cpi) ? forecast.cpi.toFixed(2) : '∞'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">EAC ajustado</dt>
          <dd className="font-medium tabular-nums">{formatUsd(forecast.eac)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">VAC</dt>
          <dd className="flex items-center gap-1 font-medium tabular-nums">
            <TrendIcon
              className={`h-3 w-3 ${forecast.vac >= 0 ? 'text-emerald-500' : 'text-red-500'}`}
              aria-hidden
            />
            {formatUsd(forecast.vac)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        Factor velocity: {forecast.velocityFactor.toFixed(2)} · ETC:{' '}
        {formatUsd(forecast.etc)}
      </p>
    </article>
  )
}
