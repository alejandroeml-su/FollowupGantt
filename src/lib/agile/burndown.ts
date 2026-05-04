/**
 * Helpers puros (sin I/O) para métricas Agile (Ola P2 · Equipo P2-2).
 *
 * Todas las funciones son determinísticas y operan en UTC. Trabajamos en
 * "días" enteros desde el `startDate` del sprint para que el burndown se
 * dibuje sobre un eje X consistente entre cliente y servidor.
 *
 * Convenciones:
 *  - Story points "completados" = tareas con `status === 'DONE'`.
 *  - El burndown ideal es lineal entre `capacity` (día 0) y `0` (último día).
 *  - El burndown actual usa `updatedAt` de cada DONE como su "día de cierre".
 *    Si una tarea ya estaba DONE antes del sprint, cuenta para el día 0.
 *  - Velocity histórica se devuelve en orden cronológico ascendente (más
 *    reciente al final) para que el chart no tenga que reordenar.
 *
 * Las escala de puntos de historia válida (Fibonacci) está duplicada en
 * `src/lib/actions/sprints.ts` adrede para que ambos módulos (puro y
 * server action) puedan importarla sin acoplar el helper a `'use server'`.
 */

export const FIBONACCI_STORY_POINTS = [1, 2, 3, 5, 8, 13, 21] as const

export type FibonacciPoint = (typeof FIBONACCI_STORY_POINTS)[number]

/** Valida si un número entero es un valor válido de la escala Fibonacci. */
export function isValidStoryPoints(value: unknown): value is FibonacciPoint {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (FIBONACCI_STORY_POINTS as readonly number[]).includes(value)
  )
}

// ─── Tipos compartidos ──────────────────────────────────────────────

export interface BurndownSprintLike {
  startDate: Date | string
  endDate: Date | string
  capacity?: number | null
}

export interface BurndownTaskLike {
  status: string
  storyPoints?: number | null
  /**
   * Timestamp del último update. En la práctica, el server lo equipara con
   * el cierre real de la tarea (transición a DONE). Para tareas no-DONE
   * el campo es ignorado.
   */
  updatedAt?: Date | string | null
}

export interface BurndownPoint {
  /** Día desde startDate del sprint (0 = inicio, N = endDate). */
  day: number
  /** Fecha ISO YYYY-MM-DD asociada al `day`. */
  date: string
  /** Puntos pendientes según la línea ideal lineal. */
  idealRemaining: number
  /**
   * Puntos pendientes reales en ese día. Es `null` para días futuros (no
   * podemos predecir lo que aún no ocurrió). El cliente del chart debe
   * pintar la línea actual sólo hasta el último valor non-null.
   */
  actualRemaining: number | null
}

export interface VelocityPoint {
  sprintId: string
  sprintName: string
  capacity: number
  velocityActual: number
}

// ─── Utilidades de fechas (UTC midnight) ───────────────────────────

const MS_PER_DAY = 86_400_000

function toDate(input: Date | string): Date {
  return input instanceof Date ? new Date(input.getTime()) : new Date(input)
}

function toUtcMidnight(input: Date | string): Date {
  const d = toDate(input)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function diffDaysUTC(a: Date, b: Date): number {
  const aMid = toUtcMidnight(a).getTime()
  const bMid = toUtcMidnight(b).getTime()
  return Math.round((bMid - aMid) / MS_PER_DAY)
}

function isoDate(d: Date): string {
  return toUtcMidnight(d).toISOString().slice(0, 10)
}

// ─── Burndown ──────────────────────────────────────────────────────

/**
 * Calcula la serie de puntos para el chart de burndown del sprint.
 *
 * @param sprint datos mínimos del sprint (start/end + capacity).
 * @param tasks tareas asignadas al sprint con su `status` y `storyPoints`.
 * @param today fecha "actual" (parametrizable para tests deterministas).
 * @returns array con un punto por cada día desde `startDate` hasta `endDate`
 *          inclusive. `actualRemaining` es null para días futuros.
 */
export function computeBurndown(
  sprint: BurndownSprintLike,
  tasks: BurndownTaskLike[],
  today: Date,
): BurndownPoint[] {
  const start = toUtcMidnight(sprint.startDate)
  const end = toUtcMidnight(sprint.endDate)
  const totalDays = Math.max(diffDaysUTC(start, end), 0)
  const todayMid = toUtcMidnight(today)
  const todayOffset = diffDaysUTC(start, todayMid)

  // Capacity preferida: la pactada al planificar; si es nullish, usar la
  // suma de storyPoints de las tareas (best-effort).
  const totalPoints = tasks.reduce(
    (sum, t) => sum + (typeof t.storyPoints === 'number' ? t.storyPoints : 0),
    0,
  )
  const capacity =
    typeof sprint.capacity === 'number' && sprint.capacity > 0
      ? sprint.capacity
      : totalPoints

  const points: BurndownPoint[] = []
  for (let day = 0; day <= totalDays; day++) {
    const date = new Date(start.getTime() + day * MS_PER_DAY)
    // Línea ideal: decae linealmente de `capacity` a 0 en `totalDays` pasos.
    const idealRemaining =
      totalDays === 0
        ? 0
        : Math.max(0, Math.round(((totalDays - day) / totalDays) * capacity * 100) / 100)

    let actualRemaining: number | null = null
    if (day <= todayOffset) {
      // Suma de puntos NO completados al final del día `day`. Una tarea
      // se considera completada en el día de su `updatedAt` (UTC midnight).
      let remaining = 0
      for (const t of tasks) {
        const points = typeof t.storyPoints === 'number' ? t.storyPoints : 0
        if (points <= 0) continue
        if (t.status !== 'DONE') {
          remaining += points
          continue
        }
        if (!t.updatedAt) {
          // DONE sin timestamp: contamos como cerrada al inicio del sprint.
          continue
        }
        const closedDay = diffDaysUTC(start, toUtcMidnight(t.updatedAt))
        if (closedDay > day) {
          // Aún no cerrada para el día evaluado.
          remaining += points
        }
      }
      actualRemaining = remaining
    }

    points.push({
      day,
      date: isoDate(date),
      idealRemaining,
      actualRemaining,
    })
  }
  return points
}

// ─── Velocity ──────────────────────────────────────────────────────

export interface VelocitySprintLike {
  id: string
  name: string
  capacity?: number | null
  velocityActual?: number | null
  endedAt?: Date | string | null
  endDate?: Date | string | null
  createdAt?: Date | string | null
}

/**
 * Devuelve un punto de velocity por cada sprint (cerrado o no). Los sprints
 * sin `velocityActual` se reportan con 0 — útil para mostrar capacity vs
 * "aún no entregado" en sprints en curso.
 *
 * Orden: cronológico ascendente. Usa `endedAt`, con fallback a `endDate` y
 * finalmente `createdAt` para sprints recién creados sin lifecycle real.
 */
export function computeVelocity(sprints: VelocitySprintLike[]): VelocityPoint[] {
  const sortKey = (s: VelocitySprintLike): number => {
    const ref = s.endedAt ?? s.endDate ?? s.createdAt
    if (!ref) return 0
    const d = toDate(ref)
    return Number.isNaN(d.getTime()) ? 0 : d.getTime()
  }

  return [...sprints]
    .sort((a, b) => sortKey(a) - sortKey(b))
    .map((s) => ({
      sprintId: s.id,
      sprintName: s.name,
      capacity: typeof s.capacity === 'number' ? s.capacity : 0,
      velocityActual:
        typeof s.velocityActual === 'number' ? s.velocityActual : 0,
    }))
}

// ─── Métricas de "estado del sprint" (puro) ────────────────────────

export interface SprintMetricsTaskLike {
  status: string
  storyPoints?: number | null
}

export interface SprintMetrics {
  totalPoints: number
  completedPoints: number
  remainingPoints: number
  completionRate: number
}

export function computeSprintMetrics(
  tasks: SprintMetricsTaskLike[],
): SprintMetrics {
  let total = 0
  let done = 0
  for (const t of tasks) {
    const p = typeof t.storyPoints === 'number' ? t.storyPoints : 0
    if (p <= 0) continue
    total += p
    if (t.status === 'DONE') done += p
  }
  const remaining = Math.max(0, total - done)
  const completionRate = total > 0 ? done / total : 0
  return {
    totalPoints: total,
    completedPoints: done,
    remainingPoints: remaining,
    completionRate,
  }
}
