/**
 * Wave P9 · Agile Maturity (HU-9.4 / HU-9.5) — Helpers de estado y
 * progreso de Releases. Sin server-only para que el cliente pueda
 * derivar estados visuales sin round-trip.
 *
 * Estados derivados (no se persisten en BD; se calculan):
 *   - RELEASED  — `releasedDate` no null.
 *   - DELAYED   — no released y `plannedDate < hoy`.
 *   - ON_TRACK  — no released, plannedDate futuro, progress razonable.
 *   - AT_RISK   — no released, plannedDate cercano (< 7d) y progress < 50%.
 *
 * El componente UI mapea estos estados a colores (emerald / amber /
 * indigo / rose).
 */

export type DerivedReleaseStatus =
  | 'RELEASED'
  | 'DELAYED'
  | 'ON_TRACK'
  | 'AT_RISK'

export type DeriveReleaseStatusInput = {
  plannedDate: string | Date
  releasedDate: string | Date | null
  /** % completado (0-100). Si null, se asume 0. */
  progressPct?: number | null
}

const DAY_MS = 86_400_000
const AT_RISK_WINDOW_DAYS = 7
const AT_RISK_PROGRESS_THRESHOLD = 50

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

export function deriveReleaseStatus(
  input: DeriveReleaseStatusInput,
  now: Date = new Date(),
): DerivedReleaseStatus {
  if (input.releasedDate) return 'RELEASED'
  const planned = toDate(input.plannedDate)
  const progress = input.progressPct ?? 0

  if (planned.getTime() < now.getTime()) return 'DELAYED'

  const daysUntil = Math.floor((planned.getTime() - now.getTime()) / DAY_MS)
  if (daysUntil <= AT_RISK_WINDOW_DAYS && progress < AT_RISK_PROGRESS_THRESHOLD) {
    return 'AT_RISK'
  }
  return 'ON_TRACK'
}

/**
 * Promedio simple de % completado de N items. Excluye nulls.
 * Devuelve null si no hay items con %.
 */
export function averageProgress(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (v): v is number => typeof v === 'number' && !Number.isNaN(v),
  )
  if (valid.length === 0) return null
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
}

/**
 * Días restantes entre `plannedDate` y `now`. Negativo si ya pasó.
 */
export function daysUntil(plannedDate: string | Date, now: Date = new Date()): number {
  return Math.floor((toDate(plannedDate).getTime() - now.getTime()) / DAY_MS)
}

/** Etiqueta humana del estado derivado (es-MX). */
export function releaseStatusLabel(status: DerivedReleaseStatus): string {
  switch (status) {
    case 'RELEASED':
      return 'Liberada'
    case 'DELAYED':
      return 'Atrasada'
    case 'AT_RISK':
      return 'En riesgo'
    case 'ON_TRACK':
      return 'En curso'
  }
}
