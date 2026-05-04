'use client'

/**
 * Ola P2 · Equipo P2-4 — Selector de ciclo OKR.
 *
 * Genera la lista canónica Q1-Q4, H1-H2 e Y para los próximos 2 años y
 * los 2 anteriores (rolling window). Devuelve el código serializable
 * (ej. "Q1-2026") al padre vía `onChange`.
 */

import { useMemo } from 'react'

type Props = {
  value: string
  onChange: (next: string) => void
  className?: string
  label?: string
}

function buildCycleOptions(reference: Date = new Date()): string[] {
  const year = reference.getUTCFullYear()
  const years = [year - 1, year, year + 1]
  const out: string[] = []
  for (const y of years) {
    out.push(`Y${y}`)
    out.push(`H1-${y}`, `H2-${y}`)
    out.push(`Q1-${y}`, `Q2-${y}`, `Q3-${y}`, `Q4-${y}`)
  }
  return out
}

export function CycleSelector({
  value,
  onChange,
  className,
  label = 'Ciclo',
}: Props) {
  const options = useMemo(() => buildCycleOptions(), [])
  return (
    <label className={['flex flex-col gap-1 text-xs', className].filter(Boolean).join(' ')}>
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-background px-2 py-1 text-sm"
        data-testid="cycle-selector"
      >
        {!options.includes(value) && value ? (
          <option value={value}>{value}</option>
        ) : null}
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  )
}

export { buildCycleOptions }
