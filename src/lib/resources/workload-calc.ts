/**
 * Cálculo de carga (workload) por usuario · día (Ola P8 · Equipo P8-1).
 *
 * Módulo PURO sin Prisma: dado un set de tasks asignadas con
 * `startDate/endDate/dailyEffortHours`, calcula la carga horaria
 * planificada de cada usuario en cada día del rango solicitado.
 *
 * Diferencia frente a `@/lib/workload/compute` (Ola P1.5):
 *  - Aquel agrega por SEMANA (12 columnas). Éste agrega por DÍA, lo que
 *    permite renderizar gráficos de barras con resolución diaria y
 *    detectar sobrecargas puntuales (ej. 1 día con 14h).
 *  - Aquel asume `workdayHours` constante. Éste consume `dailyEffortHours`
 *    por task — si la task no la define, cae al default que provee el caller.
 *
 * Convenciones:
 *  - Las claves de los maps son fechas ISO YYYY-MM-DD en UTC.
 *  - Los rangos se interpretan inclusive en `startDate` y `endDate`
 *    (semántica Gantt PMI: la tarea ocupa todos los días del intervalo).
 *  - Si `dailyEffortHours` no está definido, se usa `defaultDailyEffortHours`
 *    del input (típicamente 8h) para no producir cargas a 0 que escondan
 *    la realidad.
 */
export const MS_PER_DAY = 86_400_000

export interface WorkloadTaskInput {
  id: string
  title: string
  assigneeId: string
  startDate: Date
  endDate: Date
  /** Horas/día de la tarea. Si null/undefined ⇒ usa `defaultDailyEffortHours`. */
  dailyEffortHours: number | null | undefined
  /** Para tooltip/overload reporting. Opcional. */
  projectName?: string
}

export interface ComputeWorkloadInput {
  userIds: ReadonlyArray<string>
  tasks: ReadonlyArray<WorkloadTaskInput>
  rangeStart: Date
  /** Inclusivo. */
  rangeEnd: Date
  defaultDailyEffortHours?: number
  /** Días del rango que NO son laborables (overrides puntuales). Sirve para
   *  excluir festivos sin que cuenten en `totalOverloadDays`. */
  nonWorkingDays?: ReadonlyArray<Date>
  /**
   * Capacidad diaria por usuario (h) usada como umbral de overload. Si no
   * se provee, se asume `defaultDailyEffortHours`. Permite acoplar el
   * cálculo con `capacity-calc.ts` desde el caller.
   */
  capacityByUser?: ReadonlyMap<string, number>
}

export interface WorkloadDailyContribution {
  taskId: string
  taskTitle: string
  hours: number
  projectName?: string
}

export interface WorkloadDailyEntry {
  /** YYYY-MM-DD (UTC). */
  date: string
  hours: number
  contributions: WorkloadDailyContribution[]
}

export interface WorkloadByUser {
  userId: string
  /** Map<DateISO, hours>. Iteración determinista en orden ascendente de fecha. */
  dailyLoad: Map<string, number>
  /** Detalle por día con tasks que contribuyen (para tooltips). */
  dailyDetail: WorkloadDailyEntry[]
  /** Suma horas de overload (carga > capacidad). 0 si nunca está sobre capacidad. */
  totalOverloadHours: number
  /** Cantidad de días distintos con overload. */
  totalOverloadDays: number
  /** Hora máxima de carga vista en el rango. Útil para escalar el eje Y. */
  peakDailyHours: number
}

export interface WorkloadResult {
  rangeStart: Date
  rangeEnd: Date
  /** Lista ISO YYYY-MM-DD del rango (inclusive). */
  days: string[]
  byUser: WorkloadByUser[]
}

/** Devuelve copia de `d` con horas/min/seg/ms a 0 en UTC. */
export function startOfDayUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

/** Formatea fecha (UTC) a `YYYY-MM-DD`. Determinista. */
export function toIsoDay(d: Date): string {
  const day = startOfDayUTC(d)
  const y = day.getUTCFullYear()
  const m = String(day.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(day.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** Genera la lista (inclusive) de días ISO entre `from` y `to`. */
export function listDays(from: Date, to: Date): string[] {
  const a = startOfDayUTC(from).getTime()
  const b = startOfDayUTC(to).getTime()
  if (a > b) return []
  const out: string[] = []
  for (let t = a; t <= b; t += MS_PER_DAY) {
    out.push(toIsoDay(new Date(t)))
  }
  return out
}

/**
 * Itera los días que la tarea cubre dentro del rango clipping
 * `[rangeStart, rangeEnd]`. Los rangos `task.startDate`/`task.endDate`
 * se consideran inclusivos. Devuelve ISO days normalizados.
 */
export function taskDaysInRange(
  task: Pick<WorkloadTaskInput, 'startDate' | 'endDate'>,
  rangeStart: Date,
  rangeEnd: Date,
): string[] {
  const taskStart = startOfDayUTC(task.startDate).getTime()
  const taskEnd = startOfDayUTC(task.endDate).getTime()
  const a = Math.max(taskStart, startOfDayUTC(rangeStart).getTime())
  const b = Math.min(taskEnd, startOfDayUTC(rangeEnd).getTime())
  if (a > b) return []
  const out: string[] = []
  for (let t = a; t <= b; t += MS_PER_DAY) {
    out.push(toIsoDay(new Date(t)))
  }
  return out
}

/**
 * Calcula la carga diaria por usuario en el rango pedido.
 *
 * Algoritmo:
 *   1. Para cada `userId` se inicializa el map con todos los días del
 *      rango a 0 (fácil de iterar después en orden).
 *   2. Por cada task del usuario, se calculan los días que cae dentro
 *      del rango y se suman `effortHours` al day de cada uno de ellos.
 *   3. Tras agregar, se calcula `peakDailyHours`, `totalOverloadHours`
 *      y `totalOverloadDays` comparando con `capacityByUser` (o el
 *      default si el caller no pasa map).
 *
 * Determinista — el orden de salida sigue el orden de `userIds` recibido.
 */
export function computeWorkload(input: ComputeWorkloadInput): WorkloadResult {
  if (!input.rangeStart || !input.rangeEnd) {
    throw new Error('[INVALID_INPUT] rangeStart y rangeEnd son obligatorios')
  }
  const rangeStart = startOfDayUTC(input.rangeStart)
  const rangeEnd = startOfDayUTC(input.rangeEnd)
  if (rangeStart.getTime() > rangeEnd.getTime()) {
    throw new Error('[INVALID_INPUT] rangeStart debe ser <= rangeEnd')
  }
  const defaultHours = input.defaultDailyEffortHours ?? 8
  if (defaultHours <= 0) {
    throw new Error('[INVALID_INPUT] defaultDailyEffortHours debe ser > 0')
  }
  const nonWorkingSet = new Set(
    (input.nonWorkingDays ?? []).map((d) => toIsoDay(d)),
  )
  const days = listDays(rangeStart, rangeEnd)

  const byUser: WorkloadByUser[] = input.userIds.map((userId) => {
    const dailyLoad = new Map<string, number>()
    const detailMap = new Map<string, WorkloadDailyContribution[]>()
    for (const d of days) {
      dailyLoad.set(d, 0)
      detailMap.set(d, [])
    }

    for (const task of input.tasks) {
      if (task.assigneeId !== userId) continue
      const effort = task.dailyEffortHours ?? defaultHours
      if (effort <= 0) continue
      const taskDays = taskDaysInRange(task, rangeStart, rangeEnd)
      for (const dayIso of taskDays) {
        // Si el día está marcado como no-laborable, NO se suma carga
        // (las tasks "no trabajan" en festivos por convención del módulo).
        if (nonWorkingSet.has(dayIso)) continue
        dailyLoad.set(dayIso, (dailyLoad.get(dayIso) ?? 0) + effort)
        detailMap.get(dayIso)?.push({
          taskId: task.id,
          taskTitle: task.title,
          hours: effort,
          projectName: task.projectName,
        })
      }
    }

    const capacity = input.capacityByUser?.get(userId) ?? defaultHours
    let peakDailyHours = 0
    let totalOverloadHours = 0
    let totalOverloadDays = 0

    for (const d of days) {
      const hours = dailyLoad.get(d) ?? 0
      if (hours > peakDailyHours) peakDailyHours = hours
      if (hours > capacity) {
        totalOverloadHours += hours - capacity
        totalOverloadDays++
      }
    }

    const dailyDetail: WorkloadDailyEntry[] = days.map((d) => ({
      date: d,
      hours: dailyLoad.get(d) ?? 0,
      contributions: detailMap.get(d) ?? [],
    }))

    return {
      userId,
      dailyLoad,
      dailyDetail,
      totalOverloadHours,
      totalOverloadDays,
      peakDailyHours,
    }
  })

  return { rangeStart, rangeEnd, days, byUser }
}

/**
 * Devuelve el factor de utilización (0..∞) para un día concreto, dada la
 * carga (`hours`) y la capacidad (`capacity`). Útil para colorear barras.
 * - 0 ⇒ sin carga.
 * - 1 ⇒ exactamente al límite.
 * - >1 ⇒ overload (rojo).
 */
export function utilizationRatio(hours: number, capacity: number): number {
  if (capacity <= 0) return hours > 0 ? Number.POSITIVE_INFINITY : 0
  return hours / capacity
}
