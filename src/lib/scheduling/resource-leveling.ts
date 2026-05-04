/**
 * Resource Leveling (Ola P5) — módulo puro, sin Prisma ni I/O.
 *
 * Algoritmo greedy "task-shift" determinista:
 *   1. Construye un calendario de carga `load[day][userId]` sumando
 *      `dailyEffortHours` de cada tarea por cada día laborable que va
 *      desde startDate (=ES) hasta endDate (=EF) inclusive.
 *   2. Recorre los días en orden. Si `load[day][userId] > capacity[userId]`,
 *      busca la última (en empuje) tarea no-crítica asignada a ese
 *      recurso ese día y propone moverla `delta` días laborables a
 *      futuro hasta que (a) el conflicto desaparece, (b) se rompe slack
 *      disponible, o (c) se rompe la hardDeadline.
 *   3. Recalcula la carga acumulada con el shift propuesto antes de
 *      pasar al siguiente día (efecto cascada controlado).
 *
 * Determinismo: tareas se eligen para empujar ordenando por
 *   (priority desc, slack desc, taskId asc).
 *
 * NO muta BD: solo devuelve un plan `LevelingChange[]` que la server
 * action aplica en transaction.
 */

import {
  addWorkdays,
  isWorkday,
  startOfDayUTC,
  type WorkCalendarLike,
} from './work-calendar'
import type {
  ExtendedCpmOutput,
  ExtendedCpmTaskResult,
} from './cpm-extended'

const MS_PER_DAY = 86_400_000
/** Cota superior de iteraciones del shift greedy por tarea. */
const MAX_SHIFT_DAYS = 365

export type LevelingReason =
  | 'OVER_CAPACITY'
  | 'NO_SLACK'
  | 'HARD_DEADLINE'
  | 'NO_ASSIGNEE'
  | 'CRITICAL'

/**
 * Cambio propuesto sobre una tarea para resolver una sobreasignación.
 *
 * `deltaDays`: cuántos días laborables se desplaza la tarea hacia
 * adelante (siempre ≥ 1 cuando se propone un cambio).
 *
 * `reason`: clasificación del cambio para mostrar en UI:
 *   - OVER_CAPACITY: el día originalStart estaba sobreasignado y se mueve.
 *   - NO_SLACK / HARD_DEADLINE / CRITICAL / NO_ASSIGNEE: motivos por los
 *     que NO se pudo proponer cambio (informativo, deltaDays=0).
 */
export interface LevelingChange {
  taskId: string
  assigneeId: string
  originalStart: Date
  proposedStart: Date
  originalEnd: Date
  proposedEnd: Date
  deltaDays: number
  reason: LevelingReason
}

export interface LevelingPlanInput {
  cpm: ExtendedCpmOutput
  /** Capacidad diaria en horas por usuario (id → horas). */
  capacityPerDay: Map<string, number>
  /** Calendario laboral. Si ausente, usa lun-vie 8h por defecto. */
  calendar?: WorkCalendarLike
  /** Default workday hours si una tarea no tiene `dailyEffortHours`. */
  defaultDailyEffortHours?: number
}

export interface LevelingPlan {
  changes: LevelingChange[]
  /** Issues no resueltos: misma forma pero con deltaDays=0. */
  unresolved: LevelingChange[]
  /** Total días-pico que estaban sobre capacidad antes del leveling. */
  overloadedDayCount: number
}

// ────────────────────────── Helpers ──────────────────────────────

function dayKey(d: Date): number {
  return Math.floor(startOfDayUTC(d).getTime() / MS_PER_DAY)
}

function* iterateWorkdays(
  from: Date,
  to: Date,
  calendar: WorkCalendarLike | undefined,
): Generator<Date> {
  // [from, to] inclusive. Si calendar=undefined, días corridos.
  let cursor = startOfDayUTC(from)
  const end = startOfDayUTC(to)
  // Si `from` no es laborable, salta.
  if (calendar && !isWorkday(cursor, calendar)) {
    cursor = addWorkdays(cursor, 1, calendar)
  }
  while (cursor.getTime() <= end.getTime()) {
    yield new Date(cursor)
    if (calendar) {
      cursor = addWorkdays(cursor, 1, calendar)
    } else {
      cursor = new Date(cursor.getTime() + MS_PER_DAY)
    }
  }
}

interface TaskSpan {
  taskId: string
  assigneeId: string
  effort: number
  start: Date
  end: Date
  slackDays: number
  hardDeadline: Date | null
  priority: number
  isCritical: boolean
}

/**
 * Construye `load[dayKey][userId]` y un map paralelo `tasksOnDay` para
 * recuperar rápido las tareas que ocupan un día/recurso.
 */
function buildLoadMap(
  spans: TaskSpan[],
  calendar: WorkCalendarLike | undefined,
): {
  load: Map<number, Map<string, number>>
  tasksOnDay: Map<number, Map<string, string[]>>
} {
  const load = new Map<number, Map<string, number>>()
  const tasksOnDay = new Map<number, Map<string, string[]>>()
  for (const s of spans) {
    for (const day of iterateWorkdays(s.start, s.end, calendar)) {
      const k = dayKey(day)
      let dayMap = load.get(k)
      if (!dayMap) {
        dayMap = new Map()
        load.set(k, dayMap)
      }
      dayMap.set(s.assigneeId, (dayMap.get(s.assigneeId) ?? 0) + s.effort)

      let tDayMap = tasksOnDay.get(k)
      if (!tDayMap) {
        tDayMap = new Map()
        tasksOnDay.set(k, tDayMap)
      }
      const arr = tDayMap.get(s.assigneeId) ?? []
      arr.push(s.taskId)
      tDayMap.set(s.assigneeId, arr)
    }
  }
  return { load, tasksOnDay }
}

/** Aplica un shift en `load`/`tasksOnDay` removiendo días viejos y añadiendo nuevos. */
function applyShift(
  span: TaskSpan,
  newStart: Date,
  newEnd: Date,
  load: Map<number, Map<string, number>>,
  tasksOnDay: Map<number, Map<string, string[]>>,
  calendar: WorkCalendarLike | undefined,
) {
  // Restar carga previa.
  for (const day of iterateWorkdays(span.start, span.end, calendar)) {
    const k = dayKey(day)
    const dayMap = load.get(k)
    if (dayMap) {
      const cur = dayMap.get(span.assigneeId) ?? 0
      const next = cur - span.effort
      if (next <= 0) dayMap.delete(span.assigneeId)
      else dayMap.set(span.assigneeId, next)
    }
    const tDayMap = tasksOnDay.get(k)
    if (tDayMap) {
      const arr = (tDayMap.get(span.assigneeId) ?? []).filter(
        (t) => t !== span.taskId,
      )
      if (arr.length === 0) tDayMap.delete(span.assigneeId)
      else tDayMap.set(span.assigneeId, arr)
    }
  }
  // Sumar carga nueva.
  for (const day of iterateWorkdays(newStart, newEnd, calendar)) {
    const k = dayKey(day)
    let dayMap = load.get(k)
    if (!dayMap) {
      dayMap = new Map()
      load.set(k, dayMap)
    }
    dayMap.set(
      span.assigneeId,
      (dayMap.get(span.assigneeId) ?? 0) + span.effort,
    )
    let tDayMap = tasksOnDay.get(k)
    if (!tDayMap) {
      tDayMap = new Map()
      tasksOnDay.set(k, tDayMap)
    }
    const arr = tDayMap.get(span.assigneeId) ?? []
    arr.push(span.taskId)
    tDayMap.set(span.assigneeId, arr)
  }
  // Mutar el span.
  span.start = newStart
  span.end = newEnd
}

function shiftWorkdays(
  d: Date,
  days: number,
  calendar: WorkCalendarLike | undefined,
): Date {
  if (calendar) return addWorkdays(d, days, calendar)
  return new Date(startOfDayUTC(d).getTime() + days * MS_PER_DAY)
}

// ────────────────────────── Core ──────────────────────────────

/**
 * Calcula el plan de leveling. NO muta los inputs.
 *
 * Estrategia:
 *   - Spans = tareas con assignee, no archivadas, dailyEffort > 0,
 *     duración > 0 (los hitos se ignoran porque no consumen capacidad).
 *   - Para cada día con sobrecarga, recorre tareas candidatas en orden
 *     (priority asc, slack asc, taskId asc) — la última en la cola se
 *     empuja primero (el "más sacrificable").
 *
 * Cota: MAX_SHIFT_DAYS evita bucles patológicos en escenarios donde
 * todos los recursos están saturados de modo permanente.
 */
export function levelResources(input: LevelingPlanInput): LevelingPlan {
  const { cpm, capacityPerDay, calendar } = input
  const defaultEffort = input.defaultDailyEffortHours ?? 8

  const changes: LevelingChange[] = []
  const unresolved: LevelingChange[] = []

  // 1) Construir spans.
  const allResults: ExtendedCpmTaskResult[] = Array.from(cpm.results.values())
  // Orden estable por id para reproducibilidad.
  allResults.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const spans: TaskSpan[] = []
  for (const r of allResults) {
    if (!r.assigneeId) continue
    if (r.EF <= r.ES) continue // hitos / duración 0
    const effort =
      r.dailyEffortHours == null || r.dailyEffortHours <= 0
        ? defaultEffort
        : r.dailyEffortHours
    spans.push({
      taskId: r.id,
      assigneeId: r.assigneeId,
      effort,
      start: startOfDayUTC(r.startDate),
      end: startOfDayUTC(r.endDate),
      slackDays: r.totalFloat,
      hardDeadline: r.hardDeadline ? startOfDayUTC(r.hardDeadline) : null,
      priority: r.priority,
      isCritical: r.isCritical,
    })
  }

  if (spans.length === 0) {
    return { changes: [], unresolved: [], overloadedDayCount: 0 }
  }

  // 2) Mapas de carga.
  const { load, tasksOnDay } = buildLoadMap(spans, calendar)

  // 3) Identificar días con sobrecarga, ordenados por fecha asc.
  const sortedDayKeys = Array.from(load.keys()).sort((a, b) => a - b)

  let overloadedDayCount = 0
  const proposedByTask = new Map<string, LevelingChange>()
  const unresolvedByTask = new Map<string, LevelingChange>()

  for (const k of sortedDayKeys) {
    const dayMap = load.get(k)
    if (!dayMap) continue
    for (const [userId, hours] of dayMap) {
      const cap = capacityPerDay.get(userId) ?? defaultEffort
      if (hours <= cap) continue
      overloadedDayCount++

      // Candidatos: tareas que tocan ese día/usuario.
      const candidates = (tasksOnDay.get(k)?.get(userId) ?? []).slice()
      // Filtrar a spans en memoria + ordenar.
      const spanById = new Map(spans.map((s) => [s.taskId, s]))
      const candidateSpans = candidates
        .map((id) => spanById.get(id))
        .filter((s): s is TaskSpan => !!s)

      // Orden: priority asc (LOW primero = más sacrificable),
      //        slack desc (más holgura primero),
      //        taskId asc (desempate determinista).
      candidateSpans.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        if (a.slackDays !== b.slackDays) return b.slackDays - a.slackDays
        return a.taskId < b.taskId ? -1 : 1
      })

      // El "más sacrificable" se empuja primero ⇒ tomamos el primero (no
      // el último). Seguimos moviendo tareas mientras el día k siga
      // sobrecargado y queden candidatos.
      for (const span of candidateSpans) {
        const currentHours = load.get(k)?.get(userId) ?? 0
        if (currentHours <= cap) break
        if (span.isCritical) {
          if (!proposedByTask.has(span.taskId) && !unresolvedByTask.has(span.taskId)) {
            unresolvedByTask.set(span.taskId, {
              taskId: span.taskId,
              assigneeId: span.assigneeId,
              originalStart: new Date(span.start),
              proposedStart: new Date(span.start),
              originalEnd: new Date(span.end),
              proposedEnd: new Date(span.end),
              deltaDays: 0,
              reason: 'CRITICAL',
            })
          }
          continue
        }
        if (span.slackDays <= 0) {
          if (!proposedByTask.has(span.taskId) && !unresolvedByTask.has(span.taskId)) {
            unresolvedByTask.set(span.taskId, {
              taskId: span.taskId,
              assigneeId: span.assigneeId,
              originalStart: new Date(span.start),
              proposedStart: new Date(span.start),
              originalEnd: new Date(span.end),
              proposedEnd: new Date(span.end),
              deltaDays: 0,
              reason: 'NO_SLACK',
            })
          }
          continue
        }

        // Probar shifts crecientes hasta que la tarea ya no toque el día
        // sobrecargado `k`. Cada iteración prueba un delta mayor (relativo
        // a la posición actual del span). Si el delta excede el slack o
        // rompe la hardDeadline, hacemos rollback y marcamos unresolved.
        const startBeforeShift = new Date(span.start)
        const endBeforeShift = new Date(span.end)
        const slackBudget = Math.min(span.slackDays, MAX_SHIFT_DAYS)
        let applied = false
        let totalDelta = 0
        for (let delta = 1; delta <= slackBudget; delta++) {
          const newStart = shiftWorkdays(startBeforeShift, delta, calendar)
          const newEnd = shiftWorkdays(endBeforeShift, delta, calendar)
          // Validar hardDeadline.
          if (
            span.hardDeadline &&
            newEnd.getTime() > span.hardDeadline.getTime()
          ) {
            break
          }
          // Aplicar shift desde la posición actual a la nueva.
          applyShift(span, newStart, newEnd, load, tasksOnDay, calendar)
          totalDelta = delta
          // Verificar si ese día ya no contiene a esta tarea (i.e. la
          // empujamos suficientemente lejos del día k).
          const taskStillOnDay = (tasksOnDay.get(k)?.get(userId) ?? []).includes(
            span.taskId,
          )
          if (!taskStillOnDay) {
            const existing = proposedByTask.get(span.taskId)
            proposedByTask.set(span.taskId, {
              taskId: span.taskId,
              assigneeId: span.assigneeId,
              originalStart: existing?.originalStart ?? startBeforeShift,
              proposedStart: newStart,
              originalEnd: existing?.originalEnd ?? endBeforeShift,
              proposedEnd: newEnd,
              deltaDays: (existing?.deltaDays ?? 0) + delta,
              reason: 'OVER_CAPACITY',
            })
            // Consumir slack del span para que iteraciones futuras no
            // intenten gastar más allá de lo disponible.
            span.slackDays = Math.max(0, span.slackDays - delta)
            applied = true
            break
          }
        }
        if (!applied && totalDelta > 0) {
          // Rollback: ningún delta resolvió → devolver la tarea a su sitio.
          applyShift(
            span,
            startBeforeShift,
            endBeforeShift,
            load,
            tasksOnDay,
            calendar,
          )
        }
        // Continuamos con el siguiente candidato si todavía hay sobrecarga.
        void applied
      }

      // Si después de iterar todos los candidatos el día sigue sobre
      // capacidad y no había NINGÚN candidato, registramos una pseudo
      // entrada NO_ASSIGNEE para visibilidad (caso donde la carga viene
      // de tareas filtradas por defecto).
      const finalHours = load.get(k)?.get(userId) ?? 0
      if (finalHours > cap && candidateSpans.length === 0) {
        const phantomId = `__noassignee_${k}_${userId}`
        if (!unresolvedByTask.has(phantomId)) {
          const dayDate = new Date(k * MS_PER_DAY)
          unresolvedByTask.set(phantomId, {
            taskId: phantomId,
            assigneeId: userId,
            originalStart: dayDate,
            proposedStart: dayDate,
            originalEnd: dayDate,
            proposedEnd: dayDate,
            deltaDays: 0,
            reason: 'NO_ASSIGNEE',
          })
        }
      }
    }
  }

  // 4) Empaquetar resultados ordenados por taskId.
  changes.push(
    ...Array.from(proposedByTask.values()).sort((a, b) =>
      a.taskId < b.taskId ? -1 : 1,
    ),
  )
  unresolved.push(
    ...Array.from(unresolvedByTask.values()).sort((a, b) =>
      a.taskId < b.taskId ? -1 : 1,
    ),
  )

  return { changes, unresolved, overloadedDayCount }
}

/**
 * Helper: construye un Map<userId, capacityPerDay> a partir de una lista
 * de usuarios y un valor uniforme. Útil cuando todavía no existe la
 * tabla `UserCapacity` (P5 deja la capacidad uniforme = workdayHours).
 */
export function buildUniformCapacity(
  userIds: string[],
  hoursPerDay: number,
): Map<string, number> {
  const m = new Map<string, number>()
  for (const id of userIds) m.set(id, hoursPerDay)
  return m
}
