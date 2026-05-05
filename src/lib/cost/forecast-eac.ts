/**
 * Ola P8 · Equipo P8-3 · Cost Management — EAC forecast.
 *
 * Calcula el Estimate at Completion (EAC) de un proyecto combinando
 * Earned Value Management (EVM) clásico con un ajuste empírico por
 * velocity reciente del equipo (últimos N sprints). Es función pura:
 * no toca BD ni tiempo del wall-clock; los datos de entrada los provee
 * el caller (server action que consulta Prisma).
 *
 * Fórmulas:
 *   - BAC (Budget at Completion) = sum(plannedValue de tasks).
 *   - AC  (Actual Cost)          = sum(Expense.amountUsd aprobado/reembolsado).
 *   - EV  (Earned Value)         = sum(plannedValue × progress/100).
 *   - CPI (Cost Performance Idx) = EV / AC. Si AC=0, CPI=Infinity (proyectos
 *     sin gastos → no hay drift de costo todavía).
 *   - EAC base = BAC / CPI (PMI estándar). Si CPI = 0 (EV=0, AC>0) usamos
 *     `EAC = AC + (BAC - EV)` para mantener finite y conservador.
 *   - Velocity factor: avgVelocity(últimos N) / targetVelocity, capped
 *     [0.7, 1.3]. Equipos por debajo del target → factor < 1 reduce
 *     "throughput" esperado y por tanto incrementa EAC esperado
 *     (multiplicamos EAC por 1/factor para escenario adverso).
 *
 * Decisión D-EAC-1: el factor de velocity se aplica como multiplicador
 *   `EAC * (1 + (1 - factor))` cuando factor < 1 (penaliza). Cuando
 *   factor >= 1 NO premiamos (no reducimos EAC) — sesgamos conservador
 *   por principio "no over-promise".
 *
 * Decisión D-EAC-2: si N sprints completados < 1 (proyecto recién
 *   arrancado), `velocityFactor = 1` (no aplica ajuste).
 */

export interface TaskForEac {
  id: string
  plannedValue: number | null
  progress: number // 0-100
}

export interface SprintVelocityPoint {
  sprintId: string
  /** Velocity actual en story points al cerrar el sprint. */
  velocityActual: number | null
  /** Capacity comprometida (input humano). */
  capacity: number | null
  endedAt: Date | null
}

export interface ForecastInput {
  /** Tasks del proyecto con su plannedValue y progress%. */
  tasks: readonly TaskForEac[]
  /** Costo actual incurrido en USD (suma `Expense.amountUsd`). */
  actualCostUsd: number
  /** Sprints históricos del proyecto (todos los terminados). */
  sprints: readonly SprintVelocityPoint[]
  /**
   * Velocity objetivo del equipo (story points/sprint). Si `null`, usa el
   * promedio del proyecto excluyendo los últimos `velocityWindow`.
   */
  targetVelocity?: number | null
  /** Cuántos sprints recientes considerar. Default 3. */
  velocityWindow?: number
  /**
   * BAC override. Si se provee, sobrescribe sum(plannedValue). Útil cuando
   * el `Project.budget` está seteado y queremos forecast contra ese baseline.
   */
  bacOverride?: number | null
}

export interface ForecastResult {
  bac: number
  ac: number
  ev: number
  cpi: number
  /** EAC sin ajuste por velocity (PMI clásico). */
  eacBase: number
  /** Factor multiplicador derivado de velocity (capped 0.7-1.3). */
  velocityFactor: number
  /** EAC final ajustado por velocity. */
  eac: number
  /** VAC = BAC - EAC. Negativo = sobrecosto previsto. */
  vac: number
  /** ETC = max(0, EAC - AC). */
  etc: number
}

const DEFAULT_VELOCITY_WINDOW = 3
const VELOCITY_FACTOR_FLOOR = 0.7
const VELOCITY_FACTOR_CEIL = 1.3

/**
 * Calcula el EAC del proyecto. Ver header del módulo para fórmulas.
 */
export function forecastEac(input: ForecastInput): ForecastResult {
  const { tasks, actualCostUsd, sprints } = input
  const window = Math.max(1, input.velocityWindow ?? DEFAULT_VELOCITY_WINDOW)

  const bac = input.bacOverride && input.bacOverride > 0
    ? input.bacOverride
    : tasks.reduce((acc, t) => acc + (t.plannedValue ?? 0), 0)

  const ev = tasks.reduce((acc, t) => {
    const pv = t.plannedValue ?? 0
    const p = clamp(t.progress, 0, 100)
    return acc + (pv * p) / 100
  }, 0)

  const ac = Math.max(0, actualCostUsd)

  // CPI: si AC=0 → Infinity (no drift conocido). Si EV=0 con AC>0 → CPI=0.
  let cpi: number
  if (ac === 0) {
    cpi = Number.POSITIVE_INFINITY
  } else {
    cpi = ev / ac
  }

  // EAC base PMI: BAC / CPI. Si CPI=0 → fallback conservador.
  let eacBase: number
  if (!isFinite(cpi)) {
    // No drift detectable todavía — EAC ≈ BAC (proyecto nuevo).
    eacBase = bac
  } else if (cpi <= 0) {
    eacBase = ac + Math.max(0, bac - ev)
  } else {
    eacBase = bac / cpi
  }

  // Velocity factor: ratio avgVelocity(reciente) / target. Capped.
  const velocityFactor = computeVelocityFactor(sprints, window, input.targetVelocity ?? null)

  // Aplicar penalización: si factor < 1 (equipo lento) inflamos EAC.
  // Si factor ≥ 1, no premiamos (EAC stays).
  const penalty = velocityFactor < 1 ? 1 + (1 - velocityFactor) : 1
  const eac = round2(eacBase * penalty)

  const vac = round2(bac - eac)
  const etc = round2(Math.max(0, eac - ac))

  return {
    bac: round2(bac),
    ac: round2(ac),
    ev: round2(ev),
    cpi: isFinite(cpi) ? round4(cpi) : Number.POSITIVE_INFINITY,
    eacBase: round2(eacBase),
    velocityFactor: round4(velocityFactor),
    eac,
    vac,
    etc,
  }
}

/**
 * Calcula el factor de velocity (capped 0.7-1.3) a partir del histórico de
 * sprints. Sólo considera sprints terminados (`endedAt != null` y
 * `velocityActual != null`).
 *
 * Si hay menos de 1 sprint terminado → factor = 1 (no ajuste, D-EAC-2).
 * Si no se especifica `targetVelocity`, usa el promedio del HISTÓRICO
 * COMPLETO (excluyendo la ventana reciente) o, si no hay suficiente
 * histórico previo, usa la `capacity` mediana como proxy.
 */
export function computeVelocityFactor(
  sprints: readonly SprintVelocityPoint[],
  window: number,
  targetVelocity: number | null,
): number {
  const completed = sprints
    .filter((s) => s.endedAt !== null && typeof s.velocityActual === 'number' && s.velocityActual >= 0)
    .sort((a, b) => (b.endedAt!.getTime() - a.endedAt!.getTime()))

  if (completed.length === 0) return 1

  const recent = completed.slice(0, window)
  const avgRecent = avg(recent.map((s) => s.velocityActual ?? 0))

  let target: number
  if (targetVelocity !== null && targetVelocity > 0) {
    target = targetVelocity
  } else {
    const historical = completed.slice(window)
    if (historical.length > 0) {
      target = avg(historical.map((s) => s.velocityActual ?? 0))
    } else {
      // No hay histórico previo a la ventana → usar capacity mediana
      // como proxy del compromiso planeado.
      const caps = completed
        .map((s) => s.capacity ?? 0)
        .filter((c) => c > 0)
        .sort((a, b) => a - b)
      if (caps.length === 0) return 1
      target = caps[Math.floor(caps.length / 2)]
    }
  }

  if (target <= 0) return 1

  const raw = avgRecent / target
  return clamp(raw, VELOCITY_FACTOR_FLOOR, VELOCITY_FACTOR_CEIL)
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min
  if (n > max) return max
  return n
}

function avg(arr: readonly number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function round2(n: number): number {
  if (!isFinite(n)) return n
  return Math.round(n * 100) / 100
}

function round4(n: number): number {
  if (!isFinite(n)) return n
  return Math.round(n * 10000) / 10000
}
