/**
 * Hard Deadline Check (Ola P5) — módulo puro, sin Prisma ni I/O.
 *
 * Dado el resultado de `computeExtendedCpm`, identifica:
 *   - `violations`: tareas cuya EF (Earliest Finish) ya supera la
 *     hardDeadline ⇒ slack < 0 días laborables.
 *   - `warnings`:   tareas dentro de un día laborable de margen
 *     (0 ≤ slack < 1) ⇒ alerta temprana.
 *
 * Convención de `slack`:
 *   slack = workdaysBetween(EF, hardDeadline, calendar)
 * con `from` incluido y `to` excluido (ver `workdaysBetween`). Negativo
 * cuando EF > hardDeadline.
 *
 * Si no hay calendario, se usan días corridos (legacy). Si la tarea no
 * tiene hardDeadline, se omite del resultado.
 */

import type {
  ExtendedCpmOutput,
  ExtendedCpmTaskResult,
} from './cpm-extended'
import {
  startOfDayUTC,
  workdaysBetween,
  type WorkCalendarLike,
} from './work-calendar'

const MS_PER_DAY = 86_400_000

export interface HardDeadlineEntry {
  taskId: string
  hardDeadline: Date
  earlyFinish: Date
  /** Días laborables (o corridos) entre EF y hardDeadline. */
  slackDays: number
}

export interface HardDeadlineCheckResult {
  violations: HardDeadlineEntry[]
  warnings: HardDeadlineEntry[]
  /** Tareas con hardDeadline que están a salvo (slack ≥ 1). */
  safe: HardDeadlineEntry[]
}

/**
 * Calcula `slack` en días (laborables si hay calendar, corridos si no).
 *
 * - `from = EF`, `to = hardDeadline`.
 * - Si EF > hardDeadline ⇒ negativo.
 * - Si EF == hardDeadline ⇒ 0 (en el límite, conservador → warning).
 */
function diffDays(
  earlyFinish: Date,
  hardDeadline: Date,
  calendar: WorkCalendarLike | undefined,
): number {
  const from = startOfDayUTC(earlyFinish)
  const to = startOfDayUTC(hardDeadline)
  if (calendar) {
    return workdaysBetween(from, to, calendar)
  }
  // Días corridos.
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/**
 * Recorre los resultados del CPM extendido y clasifica las tareas con
 * hardDeadline en violations / warnings / safe.
 *
 * Determinismo: ordena por (slack asc, taskId asc) para que la salida sea
 * estable ante misma entrada. Las tareas sin hardDeadline no aparecen.
 */
export function checkHardDeadlines(
  cpm: ExtendedCpmOutput,
  calendar?: WorkCalendarLike,
): HardDeadlineCheckResult {
  const violations: HardDeadlineEntry[] = []
  const warnings: HardDeadlineEntry[] = []
  const safe: HardDeadlineEntry[] = []

  // Iterar ordenado por id para construcción determinista.
  const ordered: ExtendedCpmTaskResult[] = Array.from(cpm.results.values())
  ordered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const r of ordered) {
    if (!r.hardDeadline) continue
    const slackDays = diffDays(r.endDate, r.hardDeadline, calendar)
    const entry: HardDeadlineEntry = {
      taskId: r.id,
      hardDeadline: r.hardDeadline,
      earlyFinish: r.endDate,
      slackDays,
    }
    if (slackDays < 0) {
      violations.push(entry)
    } else if (slackDays < 1) {
      warnings.push(entry)
    } else {
      safe.push(entry)
    }
  }

  // Asegurar ordenamiento final estable.
  const cmp = (a: HardDeadlineEntry, b: HardDeadlineEntry) =>
    a.slackDays !== b.slackDays
      ? a.slackDays - b.slackDays
      : a.taskId < b.taskId
        ? -1
        : 1
  violations.sort(cmp)
  warnings.sort(cmp)
  safe.sort(cmp)

  return { violations, warnings, safe }
}

/**
 * Helper UI: devuelve un resumen agregado. Útil para el header de la
 * página /leveling y para tooltips del Gantt sin recorrer la lista.
 */
export function summarizeHardDeadlineCheck(
  result: HardDeadlineCheckResult,
): { totalWithDeadline: number; violationCount: number; warningCount: number } {
  return {
    totalWithDeadline:
      result.violations.length + result.warnings.length + result.safe.length,
    violationCount: result.violations.length,
    warningCount: result.warnings.length,
  }
}
