/**
 * Ola P5 · Equipo P5-3 · Reportes ejecutivos
 *
 * Cálculo determinista de métricas Earned Value Management (EVM/PMBOK):
 *   - PV (Planned Value):  costo planificado del trabajo programado a la fecha.
 *   - EV (Earned Value):   costo planificado del trabajo realmente completado.
 *   - AC (Actual Cost):    costo real incurrido a la fecha.
 *   - SV (Schedule Variance) = EV − PV    (>0 adelantado, <0 retrasado)
 *   - CV (Cost Variance)     = EV − AC    (>0 bajo presupuesto, <0 sobregiro)
 *   - SPI (Schedule Index)   = EV / PV    (>=1 a tiempo, <1 retrasado)
 *   - CPI (Cost Index)       = EV / AC    (>=1 eficiente, <1 sobregiro)
 *   - EAC (Estimate at Completion) = BAC / CPI (estimación final si CPI > 0)
 *   - VAC (Variance at Completion) = BAC − EAC
 *
 * Convenciones del cálculo en este proyecto:
 *   - PV se acumula con `plannedValue` para tareas cuyo `endDate` (o
 *     `startDate` si no hay endDate) sea <= asOf. Si una tarea tiene
 *     endDate futura pero ya empezó (startDate <= asOf <= endDate)
 *     se prorratea linealmente en función del tiempo transcurrido.
 *   - EV = sum(plannedValue * progress / 100). Si `earnedValue` viene
 *     pre-calculado (cache en BD) se prefiere para evitar drift.
 *   - AC = sum(actualCost). Si `actualCost` es null para todas las tareas
 *     se devuelve `acIsEstimated: true` y se usa `EV` como proxy (asume
 *     CPI=1 mientras no haya costos reales).
 *
 * Errores tipados:
 *   - [INVALID_INPUT]      progreso fuera de rango / fecha NaN.
 *   - [INSUFFICIENT_DATA]  ninguna tarea con plannedValue > 0.
 */

export type EVMTaskInput = {
  id: string
  title?: string
  plannedValue: number | null
  actualCost: number | null
  earnedValue: number | null
  progress: number
  startDate: Date | null
  endDate: Date | null
}

export type EVMResult = {
  // Totales primarios.
  pv: number
  ev: number
  ac: number
  // Métricas derivadas.
  sv: number
  cv: number
  spi: number | null
  cpi: number | null
  // Estimaciones al cierre. BAC = sum(plannedValue) total del proyecto.
  bac: number
  eac: number | null
  vac: number | null
  // Metadatos para la UI.
  asOf: string // ISO date
  taskCount: number
  budgetedTaskCount: number // tareas con plannedValue > 0
  acIsEstimated: boolean
  // Por tarea, útil para tablas/drill-down.
  perTask: Array<{
    id: string
    title: string
    pv: number
    ev: number
    ac: number
    cv: number
    sv: number
    progress: number
  }>
}

function evmError(code: 'INVALID_INPUT' | 'INSUFFICIENT_DATA', detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

/**
 * Devuelve la fracción [0,1] del trabajo planificado de una tarea que
 * debería estar completada al `asOf`. Si no hay startDate ni endDate,
 * asumimos 0 (no programada). Si endDate <= asOf → 1. Si startDate >= asOf → 0.
 * En el medio, prorrateo lineal por días.
 */
export function plannedFraction(
  startDate: Date | null,
  endDate: Date | null,
  asOf: Date,
): number {
  if (!endDate && !startDate) return 0
  // Caso simple: solo endDate (caso típico en Gantt sin start explícito).
  if (!startDate && endDate) {
    return endDate.getTime() <= asOf.getTime() ? 1 : 0
  }
  if (startDate && !endDate) {
    return startDate.getTime() <= asOf.getTime() ? 1 : 0
  }
  // Ambas fechas presentes.
  const sd = startDate as Date
  const ed = endDate as Date
  if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) {
    evmError('INVALID_INPUT', `Fechas inválidas en EVM`)
  }
  if (asOf.getTime() <= sd.getTime()) return 0
  if (asOf.getTime() >= ed.getTime()) return 1
  const total = ed.getTime() - sd.getTime()
  if (total <= 0) return 1
  const elapsed = asOf.getTime() - sd.getTime()
  return Math.min(1, Math.max(0, elapsed / total))
}

export function computeEVM(
  tasks: EVMTaskInput[],
  asOf: Date = new Date(),
): EVMResult {
  if (!Array.isArray(tasks)) {
    evmError('INVALID_INPUT', 'tasks debe ser un arreglo')
  }
  if (Number.isNaN(asOf.getTime())) {
    evmError('INVALID_INPUT', 'asOf inválido')
  }

  let pv = 0
  let ev = 0
  let ac = 0
  let bac = 0
  let budgetedTaskCount = 0
  let acProvided = false
  const perTask: EVMResult['perTask'] = []

  for (const t of tasks) {
    if (
      typeof t.progress !== 'number' ||
      Number.isNaN(t.progress) ||
      t.progress < 0 ||
      t.progress > 100
    ) {
      evmError('INVALID_INPUT', `progress inválido en tarea ${t.id} (${t.progress})`)
    }
    const taskPV = t.plannedValue ?? 0
    if (taskPV < 0) {
      evmError('INVALID_INPUT', `plannedValue negativo en tarea ${t.id}`)
    }
    bac += taskPV
    if (taskPV > 0) budgetedTaskCount += 1

    const fraction = plannedFraction(t.startDate, t.endDate, asOf)
    const taskPVAcc = taskPV * fraction
    pv += taskPVAcc

    const taskEV =
      t.earnedValue != null && Number.isFinite(t.earnedValue)
        ? t.earnedValue
        : taskPV * (t.progress / 100)
    ev += taskEV

    const taskAC = t.actualCost ?? 0
    if (t.actualCost != null && Number.isFinite(t.actualCost)) acProvided = true
    ac += taskAC

    perTask.push({
      id: t.id,
      title: t.title ?? t.id,
      pv: taskPVAcc,
      ev: taskEV,
      ac: taskAC,
      cv: taskEV - taskAC,
      sv: taskEV - taskPVAcc,
      progress: t.progress,
    })
  }

  if (budgetedTaskCount === 0) {
    evmError(
      'INSUFFICIENT_DATA',
      'Ninguna tarea tiene plannedValue > 0; EVM no aplicable',
    )
  }

  const acIsEstimated = !acProvided
  const acFinal = acIsEstimated ? ev : ac

  const sv = ev - pv
  const cv = ev - acFinal
  const spi = pv > 0 ? ev / pv : null
  const cpi = acFinal > 0 ? ev / acFinal : null
  const eac = cpi != null && cpi > 0 ? bac / cpi : null
  const vac = eac != null ? bac - eac : null

  return {
    pv: round2(pv),
    ev: round2(ev),
    ac: round2(acFinal),
    sv: round2(sv),
    cv: round2(cv),
    spi: spi != null ? round4(spi) : null,
    cpi: cpi != null ? round4(cpi) : null,
    bac: round2(bac),
    eac: eac != null ? round2(eac) : null,
    vac: vac != null ? round2(vac) : null,
    asOf: asOf.toISOString(),
    taskCount: tasks.length,
    budgetedTaskCount,
    acIsEstimated,
    perTask: perTask.map((p) => ({
      ...p,
      pv: round2(p.pv),
      ev: round2(p.ev),
      ac: round2(p.ac),
      cv: round2(p.cv),
      sv: round2(p.sv),
    })),
  }
}

/**
 * Clasificación de salud para semáforo del portafolio.
 *   - rojo:    CV < 0   ó SPI < 0.9
 *   - amarillo: CPI < 1 ó SPI < 1 (en margen)
 *   - verde:   resto
 * Si no hay PV (proyecto sin presupuesto), devuelve `gray` y la UI muestra
 * "Sin datos".
 */
export type HealthStatus = 'green' | 'yellow' | 'red' | 'gray'

export function classifyHealth(input: {
  cv: number
  spi: number | null
  cpi: number | null
}): HealthStatus {
  if (input.spi == null && input.cpi == null) return 'gray'
  if (input.cv < 0) return 'red'
  if (input.spi != null && input.spi < 0.9) return 'red'
  if (input.cpi != null && input.cpi < 1) return 'yellow'
  if (input.spi != null && input.spi < 1) return 'yellow'
  return 'green'
}

export function formatIndex(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

export function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
