/**
 * CPM extendido (Ola P5) — wrapper sobre `computeCpm` que NO modifica el
 * cálculo base, pero anota cada `CpmTaskResult` con metadatos extra que
 * los algoritmos de hard-deadline-check y resource-leveling necesitan:
 *
 *  - `hardDeadline?: Date`        → propagada desde la entrada
 *  - `dailyEffortHours?: number`  → propagada desde la entrada
 *  - `assigneeId?: string | null` → propagada desde la entrada
 *  - `priority?: number`          → para desempate determinista en leveling
 *
 * Decisión de diseño: extender vía wrapper en lugar de tocar `cpm.ts` para
 * (a) preservar el contrato existente (lo consumen baseline-variance,
 * cpm-cache, schedule.ts, etc.), (b) mantener el módulo CPM puro libre
 * de campos que no afectan a los pases forward/backward.
 *
 * Toda la lógica que mutuamente entre fechas y "días desde projectStart"
 * vive aquí — los algoritmos posteriores se apoyan en este resultado
 * y NO vuelven a consultar el calendario directamente.
 */

import {
  computeCpm,
  type CpmInput,
  type CpmTaskInput,
  type CpmTaskResult,
  type CpmWarning,
} from './cpm'
import type { WorkCalendarLike } from './work-calendar'

/** Prioridad numérica usada para ordenar tareas en el leveling. */
export type LevelingPriority = 0 | 1 | 2 | 3
export const PRIORITY_LOW: LevelingPriority = 0
export const PRIORITY_MEDIUM: LevelingPriority = 1
export const PRIORITY_HIGH: LevelingPriority = 2
export const PRIORITY_CRITICAL: LevelingPriority = 3

/**
 * Entrada extendida: todo lo que `CpmTaskInput` pide + 4 campos opcionales
 * que sobreviven al cálculo y se devuelven en cada resultado.
 */
export interface ExtendedCpmTaskInput extends CpmTaskInput {
  hardDeadline?: Date | null
  dailyEffortHours?: number | null
  assigneeId?: string | null
  priority?: LevelingPriority
}

export interface ExtendedCpmInput
  extends Omit<CpmInput, 'tasks' | 'calendar'> {
  tasks: ExtendedCpmTaskInput[]
  calendar?: WorkCalendarLike
}

/**
 * Resultado por tarea: el original de `computeCpm` + los campos extra
 * necesarios para hard-deadline-check y resource-leveling.
 */
export interface ExtendedCpmTaskResult extends CpmTaskResult {
  hardDeadline: Date | null
  dailyEffortHours: number | null
  assigneeId: string | null
  priority: LevelingPriority
}

export interface ExtendedCpmOutput {
  results: Map<string, ExtendedCpmTaskResult>
  criticalPath: string[]
  projectDuration: number
  warnings: CpmWarning[]
}

/**
 * Ejecuta `computeCpm` sobre las tareas/dependencias dadas y enriquece
 * cada resultado con metadatos. No muta los inputs ni el calendario.
 *
 * Determinismo: el orden de `results` (Map) es el orden topológico que
 * usa `computeCpm` internamente; los consumidores NO deben asumirlo y
 * deberían iterar ordenando por `id` para outputs estables.
 */
export function computeExtendedCpm(
  input: ExtendedCpmInput,
): ExtendedCpmOutput {
  const baseInput: CpmInput = {
    projectStart: input.projectStart,
    tasks: input.tasks.map((t) => ({
      id: t.id,
      duration: t.duration,
      isMilestone: t.isMilestone,
      earliestStartConstraint: t.earliestStartConstraint,
    })),
    dependencies: input.dependencies,
    calendar: input.calendar,
  }
  const base = computeCpm(baseInput)

  // Indexar la entrada extendida por id para rehidratar metadatos.
  const metaById = new Map<string, ExtendedCpmTaskInput>()
  for (const t of input.tasks) metaById.set(t.id, t)

  const results = new Map<string, ExtendedCpmTaskResult>()
  for (const [id, r] of base.results) {
    const meta = metaById.get(id)
    results.set(id, {
      ...r,
      hardDeadline: meta?.hardDeadline ?? null,
      dailyEffortHours:
        meta?.dailyEffortHours == null ? null : Number(meta.dailyEffortHours),
      assigneeId: meta?.assigneeId ?? null,
      priority: meta?.priority ?? PRIORITY_MEDIUM,
    })
  }

  return {
    results,
    criticalPath: base.criticalPath,
    projectDuration: base.projectDuration,
    warnings: base.warnings,
  }
}

/**
 * Convierte una `Priority` enum-string del schema Prisma a la versión
 * numérica usada por el leveling. Centraliza el mapeo para que los
 * adapters (Prisma → ExtendedCpmTaskInput) no dupliquen el switch.
 */
export function priorityToNumber(
  p: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string | null | undefined,
): LevelingPriority {
  switch (p) {
    case 'CRITICAL':
      return PRIORITY_CRITICAL
    case 'HIGH':
      return PRIORITY_HIGH
    case 'LOW':
      return PRIORITY_LOW
    case 'MEDIUM':
    default:
      return PRIORITY_MEDIUM
  }
}
