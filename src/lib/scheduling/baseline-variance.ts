/**
 * HU-3.3 · Cálculo puro de varianza entre tarea real y línea base.
 *
 * Compara las fechas reales (BD) contra las fechas planificadas
 * congeladas en el snapshot de baseline. La salida alimenta:
 *  - el overlay visual (`<GanttBaselineLayer/>`): barras fantasma + bordes.
 *  - los indicadores de cada barra real (color/icono según severidad).
 *
 * Decisión D8: el Gantt sigue mostrando fechas reales — esta varianza
 * solo informa. Decisión D9: identifiers en inglés, copy visible en
 * español lo aplica el caller.
 *
 * Convención de unidades: días enteros (positivo = retraso, negativo =
 * adelanto). Coherente con `daysBetween` del propio GanttBoardClient.
 */

import type { BaselineTask } from './baseline-snapshot'

// ───────────────────────── Tipos ─────────────────────────

/**
 * Severidad cualitativa del retraso. Mapea contra el tono visual:
 *  - on-plan  → success (sin decoración, ≤0 días)
 *  - minor    → warning suave (1–5 días)
 *  - moderate → warning intenso + icono (6–15 días)
 *  - critical → danger + icono + tooltip (>15 días)
 *  - missing  → la tarea no existía cuando se capturó la línea base
 *               (sin barra fantasma; opcionalmente badge "nueva").
 *  - no-data  → la baseline no tiene fechas o la tarea real tampoco
 *               (no se puede comparar; se trata como neutral).
 */
export type VarianceClassification =
  | 'on-plan'
  | 'minor'
  | 'moderate'
  | 'critical'
  | 'missing'
  | 'no-data'

export type TaskVariance = {
  /** Diferencia realEnd − baselineEnd en días. Positivo = retraso. */
  deltaDays: number | null
  classification: VarianceClassification
  /** ISO datetime de la fecha planificada (para el aria-label). */
  plannedStart: string | null
  plannedEnd: string | null
  /** Duración planificada (días enteros, ≥1) — útil para la barra fantasma. */
  plannedDurationDays: number | null
}

/** Forma mínima de tarea real necesaria para comparar. */
export type TaskForVariance = {
  id: string
  startDate: string | null
  endDate: string | null
}

// ───────────────────────── Helpers ─────────────────────────

const MS_PER_DAY = 86_400_000

/** Days en UTC, redondeado al entero más cercano. */
function diffDaysUtc(from: Date, to: Date): number {
  return Math.round(
    (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) /
      MS_PER_DAY,
  )
}

function parseIso(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Severidad por umbrales fijos (P0 sin configuración por proyecto). Los
 * cortes están alineados con el spec HU-3.3:
 *   on-plan ≤ 0 < minor ≤ 5 < moderate ≤ 15 < critical
 * Si hay adelanto significativo lo tratamos también como `on-plan`
 * (el indicador visual usa el ausente / sin decoración).
 */
export function classifyDelta(deltaDays: number): VarianceClassification {
  if (deltaDays <= 0) return 'on-plan'
  if (deltaDays <= 5) return 'minor'
  if (deltaDays <= 15) return 'moderate'
  return 'critical'
}

// ───────────────────────── API ─────────────────────────

/**
 * Calcula la varianza para una tarea contra su entrada en el snapshot.
 * Si `snapshotEntry` es null/undefined la tarea es "nueva" (creada
 * después de la captura) y devolvemos `missing` con delta=null.
 *
 * Si la tarea o el snapshot no tienen fechas, devolvemos `no-data`.
 */
export function computeTaskVariance(
  task: TaskForVariance,
  snapshotEntry: BaselineTask | null | undefined,
): TaskVariance {
  if (!snapshotEntry) {
    return {
      deltaDays: null,
      classification: 'missing',
      plannedStart: null,
      plannedEnd: null,
      plannedDurationDays: null,
    }
  }

  const plannedStart = snapshotEntry.plannedStart
  const plannedEnd = snapshotEntry.plannedEnd
  const ps = parseIso(plannedStart)
  const pe = parseIso(plannedEnd)
  const realEnd = parseIso(task.endDate)

  // Calculamos duración planificada si ambas fechas existen, aunque
  // realEnd falte — la barra fantasma se puede pintar sin necesidad de
  // tener fechas reales.
  const plannedDurationDays =
    ps && pe ? Math.max(1, diffDaysUtc(ps, pe) + 1) : null

  if (!pe || !realEnd) {
    return {
      deltaDays: null,
      classification: 'no-data',
      plannedStart,
      plannedEnd,
      plannedDurationDays,
    }
  }

  const delta = diffDaysUtc(pe, realEnd)
  return {
    deltaDays: delta,
    classification: classifyDelta(delta),
    plannedStart,
    plannedEnd,
    plannedDurationDays,
  }
}

/**
 * Construye un mapa indexado por taskId con la varianza pre-calculada.
 * Pensado para `useMemo` en el GanttBoardClient: invalidar cuando
 * cambien `tasks` o `snapshot`.
 */
export function buildVarianceMap(
  tasks: readonly TaskForVariance[],
  snapshot: { tasks: readonly BaselineTask[] } | null | undefined,
): Map<string, TaskVariance> {
  const out = new Map<string, TaskVariance>()
  if (!snapshot) return out
  const byId = new Map<string, BaselineTask>()
  for (const bt of snapshot.tasks) byId.set(bt.id, bt)
  for (const t of tasks) {
    out.set(t.id, computeTaskVariance(t, byId.get(t.id) ?? null))
  }
  return out
}

/**
 * Texto descriptivo para `aria-label` de la barra fantasma. Cumple D9:
 * copy en español, identificadores en inglés.
 *
 * Ejemplo: "Línea base v.3 de PROJ-12: 2026-05-02 a 2026-05-08
 *          (3d retraso)"
 */
export function describeBaselineBar(args: {
  baselineVersion: number
  mnemonic: string | null
  plannedStart: string | null
  plannedEnd: string | null
  deltaDays: number | null
}): string {
  const id = args.mnemonic ?? 'tarea'
  const start = args.plannedStart?.slice(0, 10) ?? '—'
  const end = args.plannedEnd?.slice(0, 10) ?? '—'
  const delta = args.deltaDays
  let suffix = ''
  if (delta != null) {
    if (delta === 0) suffix = ' (en plan)'
    else if (delta > 0) suffix = ` (${delta}d retraso)`
    else suffix = ` (${Math.abs(delta)}d adelanto)`
  }
  return `Línea base v.${args.baselineVersion} de ${id}: ${start} a ${end}${suffix}`
}
