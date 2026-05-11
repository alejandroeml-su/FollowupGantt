/**
 * Wave P20-B · Brain Strategist — Monte Carlo cross-project simulator.
 *
 * Simulador puro (sin Prisma · sin LLM · sin Next) que estima fechas de
 * cierre por proyecto y a nivel portafolio con percentiles P10/P50/P90.
 *
 * Modelo:
 *   - Cada tarea aporta una duración Normal(media, std) truncada a >= 1d.
 *   - Las dependencias cross-project se modelan como aristas dirigidas
 *     (predecessor → successor) que fuerzan al successor a iniciar
 *     después de que termine el predecessor.
 *   - El "finish" de un proyecto es el max(finishTime) entre sus tareas
 *     (consideradas como secuencia simple aditiva sobre la rama del
 *     proyecto, salvo cuando aparecen cross-deps que las re-ordenan).
 *
 * Optimización (objetivo: 10k iter en <2s en hardware típico):
 *   - Topo-sort fuera del loop (precomputado una vez).
 *   - PRNG xorshift32 in-line (sin alloc por sample).
 *   - Samples por tarea calculados in-place sin hashmap.
 *   - Box-Muller transform compartido entre samples cuando posible.
 *
 * Complejidad: O(iterations · (T + D)) donde T=#tasks y D=#cross-deps.
 */

// ─── Tipos públicos ─────────────────────────────────────────────────

export interface MonteCarloTaskInput {
  /** Id estable (no se persiste, solo se usa como clave en el grafo). */
  id: string
  /** Id del proyecto al que pertenece esta tarea. */
  projectId: string
  /** Duración media (en días). Debe ser ≥ 1. */
  durationDaysMean: number
  /** Desviación estándar (en días). Si null/undefined, se aplica default upstream. */
  durationDaysStd: number
}

export interface MonteCarloProjectInput {
  id: string
  name: string
  tasks: MonteCarloTaskInput[]
}

export interface MonteCarloDependencyInput {
  /** Tarea predecesora (de cualquier proyecto). */
  predecessorTaskId: string
  /** Tarea sucesora (de cualquier proyecto). */
  successorTaskId: string
}

export interface MonteCarloInput {
  projects: MonteCarloProjectInput[]
  crossDeps: MonteCarloDependencyInput[]
  /** Fecha de inicio del horizonte de simulación (ISO). */
  today: string
}

export interface MonteCarloProjectResult {
  projectId: string
  projectName: string
  p10: string
  p50: string
  p90: string
  meanDays: number
  stdDays: number
  /** Muestras de #días desde `today` hasta el cierre (length = iterations). */
  samples: number[]
  /** Histograma binned para sparkline (default 20 bins). */
  histogram: { bins: number[]; min: number; max: number; binSizeDays: number }
}

export interface MonteCarloPortfolioResult {
  totalFinishP10: string
  totalFinishP50: string
  totalFinishP90: string
  meanDays: number
  stdDays: number
}

export interface MonteCarloResult {
  projects: MonteCarloProjectResult[]
  portfolio: MonteCarloPortfolioResult
  iterations: number
  today: string
  ranAt: string
}

// ─── PRNG seedable (xorshift32) ─────────────────────────────────────

/**
 * Generador determinista xorshift32. Devuelve `nextFloat()` ∈ [0,1).
 * Si `seed` es undefined o 0 usa un seed pseudo-aleatorio derivado de
 * un contador interno (no Math.random para no perder reproducibilidad
 * cuando el caller fija el seed).
 */
export interface SeededRng {
  nextFloat: () => number
  /** Sample N(0,1) usando Box-Muller (cacheado). */
  nextGaussian: () => number
}

let RNG_FALLBACK_COUNTER = 0x9e3779b1

export function seedRandom(seed?: number): SeededRng {
  let state =
    seed === undefined || seed === 0 ? ++RNG_FALLBACK_COUNTER : seed | 0
  if (state === 0) state = 0x12345678
  // Caché Box-Muller para reutilizar el segundo sample N(0,1).
  let hasCached = false
  let cached = 0

  function nextU32(): number {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
  function nextFloat(): number {
    // 32 bits → [0,1) con resolución 2^-32.
    return nextU32() / 0x1_0000_0000
  }
  function nextGaussian(): number {
    if (hasCached) {
      hasCached = false
      return cached
    }
    // Box-Muller. Evita u1=0 para no caer en log(0).
    let u1 = nextFloat()
    while (u1 === 0) u1 = nextFloat()
    const u2 = nextFloat()
    const mag = Math.sqrt(-2.0 * Math.log(u1))
    const z0 = mag * Math.cos(2 * Math.PI * u2)
    const z1 = mag * Math.sin(2 * Math.PI * u2)
    cached = z1
    hasCached = true
    return z0
  }

  return { nextFloat, nextGaussian }
}

// ─── Validación de entrada ──────────────────────────────────────────

function validateInput(input: MonteCarloInput): void {
  if (!input || !Array.isArray(input.projects)) {
    throw new Error('[INVALID_INPUT] projects requerido')
  }
  if (!Array.isArray(input.crossDeps)) {
    throw new Error('[INVALID_INPUT] crossDeps requerido')
  }
  if (!input.today || Number.isNaN(new Date(input.today).getTime())) {
    throw new Error('[INVALID_INPUT] today debe ser fecha ISO válida')
  }
  for (const p of input.projects) {
    if (!p.id || !p.name) {
      throw new Error('[INVALID_INPUT] cada proyecto requiere id y name')
    }
    for (const t of p.tasks) {
      if (!t.id) {
        throw new Error(`[INVALID_INPUT] task sin id en proyecto ${p.id}`)
      }
      if (t.durationDaysMean < 0 || !Number.isFinite(t.durationDaysMean)) {
        throw new Error(
          `[INVALID_INPUT] durationDaysMean inválida en task ${t.id}`,
        )
      }
      if (t.durationDaysStd < 0 || !Number.isFinite(t.durationDaysStd)) {
        throw new Error(
          `[INVALID_INPUT] durationDaysStd inválida en task ${t.id}`,
        )
      }
    }
  }
}

// ─── Topo-sort precomputado (Kahn) ──────────────────────────────────

interface TopoArtifacts {
  /** Lista de task ids ordenada topológicamente. */
  order: string[]
  /** index en `order` por taskId (acceso O(1)). */
  index: Map<string, number>
  /** Padres (predecessors) por task — para el max-start del successor. */
  parents: Map<string, string[]>
  /** Task → projectId para agregación por proyecto. */
  taskProject: Map<string, string>
  /** Project → task ids ese proyecto. */
  projectTasks: Map<string, string[]>
  /** Project → dependencias internas implícitas (orden de creación). */
  intraSeq: Map<string, string[]>
  /** Means/Stds indexados por taskId. */
  means: Map<string, number>
  stds: Map<string, number>
}

function buildTopo(input: MonteCarloInput): TopoArtifacts {
  const parents = new Map<string, string[]>()
  const children = new Map<string, string[]>()
  const taskProject = new Map<string, string>()
  const projectTasks = new Map<string, string[]>()
  const intraSeq = new Map<string, string[]>()
  const means = new Map<string, number>()
  const stds = new Map<string, number>()

  for (const p of input.projects) {
    const ids: string[] = []
    for (const t of p.tasks) {
      taskProject.set(t.id, p.id)
      means.set(t.id, t.durationDaysMean)
      stds.set(t.id, t.durationDaysStd)
      parents.set(t.id, [])
      children.set(t.id, [])
      ids.push(t.id)
    }
    projectTasks.set(p.id, ids)
    intraSeq.set(p.id, ids)
  }

  for (const dep of input.crossDeps) {
    // Tolerante a deps con tasks fuera del input (best-effort).
    if (!parents.has(dep.successorTaskId) || !parents.has(dep.predecessorTaskId)) {
      continue
    }
    parents.get(dep.successorTaskId)!.push(dep.predecessorTaskId)
    children.get(dep.predecessorTaskId)!.push(dep.successorTaskId)
  }

  // Kahn topo-sort. In-degree inicial = parents.length.
  const indeg = new Map<string, number>()
  for (const [tid, ps] of parents.entries()) indeg.set(tid, ps.length)
  const queue: string[] = []
  for (const [tid, d] of indeg.entries()) if (d === 0) queue.push(tid)
  const order: string[] = []
  while (queue.length > 0) {
    const u = queue.shift()!
    order.push(u)
    for (const v of children.get(u) ?? []) {
      const d = (indeg.get(v) ?? 0) - 1
      indeg.set(v, d)
      if (d === 0) queue.push(v)
    }
  }
  if (order.length !== parents.size) {
    throw new Error('[INVALID_INPUT] ciclo detectado en cross-deps')
  }
  const index = new Map<string, number>()
  order.forEach((tid, i) => index.set(tid, i))

  return { order, index, parents, taskProject, projectTasks, intraSeq, means, stds }
}

// ─── Sample truncado N(mean, std) con piso 1 día ────────────────────

function sampleDuration(mean: number, std: number, rng: SeededRng): number {
  if (std <= 0) return Math.max(1, mean)
  // Loop bounded: Box-Muller raramente saca outliers que violen el piso
  // tras 3 intentos; entonces clamp determinista a 1.
  for (let i = 0; i < 3; i++) {
    const z = rng.nextGaussian()
    const v = mean + std * z
    if (v >= 1) return v
  }
  return 1
}

// ─── Percentiles ────────────────────────────────────────────────────

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedAsc.length)),
  )
  return sortedAsc[idx]
}

function addDays(baseIso: string, days: number): string {
  const base = new Date(baseIso).getTime()
  const ms = base + days * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString()
}

function mean(values: number[]): number {
  let s = 0
  for (const v of values) s += v
  return values.length === 0 ? 0 : s / values.length
}

function std(values: number[], mu: number): number {
  if (values.length === 0) return 0
  let s = 0
  for (const v of values) {
    const d = v - mu
    s += d * d
  }
  return Math.sqrt(s / values.length)
}

function histogramOf(
  values: number[],
  bins = 20,
): { bins: number[]; min: number; max: number; binSizeDays: number } {
  if (values.length === 0) {
    return { bins: new Array(bins).fill(0), min: 0, max: 0, binSizeDays: 0 }
  }
  let mn = values[0]
  let mx = values[0]
  for (const v of values) {
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const range = mx - mn
  if (range === 0) {
    const out = new Array(bins).fill(0)
    out[Math.floor(bins / 2)] = values.length
    return { bins: out, min: mn, max: mx, binSizeDays: 0 }
  }
  const binSize = range / bins
  const out = new Array(bins).fill(0)
  for (const v of values) {
    let i = Math.floor((v - mn) / binSize)
    if (i >= bins) i = bins - 1
    if (i < 0) i = 0
    out[i]++
  }
  return { bins: out, min: mn, max: mx, binSizeDays: binSize }
}

// ─── Núcleo: runMonteCarloPortfolio ─────────────────────────────────

export interface MonteCarloOptions {
  rng?: SeededRng
  /** Cantidad de bins del histograma por proyecto (default 20). */
  histogramBins?: number
}

/**
 * Ejecuta `iterations` simulaciones Monte Carlo sobre el portafolio
 * y devuelve percentiles P10/P50/P90 por proyecto y a nivel agregado.
 *
 * El "finish" de cada task es:
 *   max(parentsFinish ∪ {prevSiblingFinish}) + sampleDuration(mean,std)
 *
 * Esto asume que las tareas de un mismo proyecto son secuenciales en
 * el orden recibido (intraSeq). Cross-deps añaden restricciones extra.
 */
export function runMonteCarloPortfolio(
  input: MonteCarloInput,
  iterations: number = 10000,
  options: MonteCarloOptions = {},
): MonteCarloResult {
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error('[INVALID_INPUT] iterations debe ser entero positivo')
  }
  validateInput(input)

  const rng = options.rng ?? seedRandom()
  const histogramBins = options.histogramBins ?? 20

  const topo = buildTopo(input)
  const T = topo.order.length
  const P = input.projects.length

  // Reservar buffers UNA VEZ fuera del loop.
  const finishTimes = new Float64Array(T)
  // Map taskId → index dentro del vector finishTimes.
  // (Reutilizamos `topo.index` para no duplicar memoria.)
  const projectSamples: Map<string, Float64Array> = new Map()
  for (const p of input.projects) {
    projectSamples.set(p.id, new Float64Array(iterations))
  }
  const portfolioSamples = new Float64Array(iterations)

  // Previous-sibling map: para cada task, qué tarea-hermana le precede
  // en el mismo proyecto (índice en finishTimes). -1 si es primera.
  const prevSibling = new Int32Array(T)
  prevSibling.fill(-1)
  for (const [, ids] of topo.projectTasks.entries()) {
    let prev = -1
    for (const tid of ids) {
      const i = topo.index.get(tid)!
      prevSibling[i] = prev
      prev = i
    }
  }

  // Parents indexados por índice topo (Int32Array de pointers + offset
  // para evitar Map.get() en hot loop).
  const parentCount = new Int32Array(T)
  let totalParents = 0
  for (let i = 0; i < T; i++) {
    const tid = topo.order[i]
    const ps = topo.parents.get(tid) ?? []
    parentCount[i] = ps.length
    totalParents += ps.length
  }
  const parentOffset = new Int32Array(T + 1)
  for (let i = 0; i < T; i++) parentOffset[i + 1] = parentOffset[i] + parentCount[i]
  const parentIdx = new Int32Array(totalParents)
  for (let i = 0; i < T; i++) {
    const tid = topo.order[i]
    const ps = topo.parents.get(tid) ?? []
    for (let k = 0; k < ps.length; k++) {
      parentIdx[parentOffset[i] + k] = topo.index.get(ps[k])!
    }
  }

  // Means/stds en Float64Array indexado por topo.
  const meansArr = new Float64Array(T)
  const stdsArr = new Float64Array(T)
  for (let i = 0; i < T; i++) {
    const tid = topo.order[i]
    meansArr[i] = topo.means.get(tid) ?? 0
    stdsArr[i] = topo.stds.get(tid) ?? 0
  }

  // ProjectId → array de task-indices del proyecto (Int32Array por proyecto).
  const projectTaskIdx: Map<string, Int32Array> = new Map()
  for (const [pid, ids] of topo.projectTasks.entries()) {
    const arr = new Int32Array(ids.length)
    for (let k = 0; k < ids.length; k++) arr[k] = topo.index.get(ids[k])!
    projectTaskIdx.set(pid, arr)
  }
  const projectFinishBuffers = new Map<string, Float64Array>()
  for (const p of input.projects) {
    projectFinishBuffers.set(p.id, projectSamples.get(p.id)!)
  }
  const projectIds = input.projects.map((p) => p.id)

  // ── HOT LOOP ────────────────────────────────────────────────────
  for (let iter = 0; iter < iterations; iter++) {
    // Para cada task en orden topo: finish = max(parents, prevSibling) + dur
    for (let i = 0; i < T; i++) {
      let earliestStart = 0
      const off = parentOffset[i]
      const cnt = parentCount[i]
      for (let k = 0; k < cnt; k++) {
        const pf = finishTimes[parentIdx[off + k]]
        if (pf > earliestStart) earliestStart = pf
      }
      const sib = prevSibling[i]
      if (sib >= 0) {
        const sf = finishTimes[sib]
        if (sf > earliestStart) earliestStart = sf
      }
      const dur = sampleDuration(meansArr[i], stdsArr[i], rng)
      finishTimes[i] = earliestStart + dur
    }

    // Agregar por proyecto y portafolio.
    let maxPortfolio = 0
    for (let p = 0; p < P; p++) {
      const pid = projectIds[p]
      const arr = projectTaskIdx.get(pid)!
      let maxFinish = 0
      for (let k = 0; k < arr.length; k++) {
        const f = finishTimes[arr[k]]
        if (f > maxFinish) maxFinish = f
      }
      projectFinishBuffers.get(pid)![iter] = maxFinish
      if (maxFinish > maxPortfolio) maxPortfolio = maxFinish
    }
    portfolioSamples[iter] = maxPortfolio
  }

  // ── Agregar resultados ─────────────────────────────────────────
  const projects: MonteCarloProjectResult[] = input.projects.map((p) => {
    const buf = projectFinishBuffers.get(p.id)!
    const samples = Array.from(buf)
    const sorted = samples.slice().sort((a, b) => a - b)
    const mu = mean(samples)
    const sd = std(samples, mu)
    return {
      projectId: p.id,
      projectName: p.name,
      p10: addDays(input.today, percentile(sorted, 10)),
      p50: addDays(input.today, percentile(sorted, 50)),
      p90: addDays(input.today, percentile(sorted, 90)),
      meanDays: mu,
      stdDays: sd,
      samples,
      histogram: histogramOf(samples, histogramBins),
    }
  })

  const pfSamples = Array.from(portfolioSamples)
  const pfSorted = pfSamples.slice().sort((a, b) => a - b)
  const pfMean = mean(pfSamples)
  const pfStd = std(pfSamples, pfMean)
  const portfolio: MonteCarloPortfolioResult = {
    totalFinishP10: addDays(input.today, percentile(pfSorted, 10)),
    totalFinishP50: addDays(input.today, percentile(pfSorted, 50)),
    totalFinishP90: addDays(input.today, percentile(pfSorted, 90)),
    meanDays: pfMean,
    stdDays: pfStd,
  }

  return {
    projects,
    portfolio,
    iterations,
    today: input.today,
    ranAt: new Date().toISOString(),
  }
}

/**
 * Calcula la probabilidad (0..1) de que el portafolio termine antes o
 * en la fecha `targetDate`. Útil para KPI "probabilidad de cumplir
 * deadline".
 */
export function probabilityFinishBy(
  result: MonteCarloResult,
  targetDate: string,
): number {
  const target = new Date(targetDate).getTime()
  const today = new Date(result.today).getTime()
  if (Number.isNaN(target)) return 0
  const targetDays = (target - today) / (1000 * 60 * 60 * 24)
  // Recomputamos a partir de los project finish samples consolidando
  // por iteración: tomamos max(projectSamples[i]) — pero ya tenemos
  // esa info por iteración en portfolio. Para evitar recargar samples
  // del portfolio (no se guardan), aproximamos vía recompute desde
  // projectos. Costo O(P * iter) y bounded a iteraciones << 1M.
  const iter = result.iterations
  let okCount = 0
  for (let i = 0; i < iter; i++) {
    let maxFinish = 0
    for (const proj of result.projects) {
      const f = proj.samples[i]
      if (f > maxFinish) maxFinish = f
    }
    if (maxFinish <= targetDays) okCount++
  }
  return iter === 0 ? 0 : okCount / iter
}
