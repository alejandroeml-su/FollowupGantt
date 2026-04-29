/**
 * Critical Path Method (CPM) — módulo puro, sin Prisma ni I/O.
 *
 * Implementa forward/backward pass clásico (PMBOK) con soporte para los 4
 * tipos de dependencia (FS, SS, FF, SF) y lag/lead. Detecta ciclos vía
 * topological sort (Kahn) y reporta warnings sin lanzar excepciones.
 *
 * Las unidades son "días enteros desde projectStart" (no fechas absolutas):
 * el caller usa `startDate`/`endDate` de cada `CpmTaskResult` para presentar.
 */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF'

export interface CpmTaskInput {
  id: string
  /** Duración en días enteros (≥ 0). Hitos: 0. */
  duration: number
  isMilestone: boolean
  /**
   * Restricción "Start No Earlier Than" (días desde projectStart).
   * Si está presente, se usa como cota inferior del ES en el forward pass.
   */
  earliestStartConstraint?: number
}

export interface CpmDependencyInput {
  predecessorId: string
  successorId: string
  type: DependencyType
  /** Lag (positivo) o lead (negativo) en días enteros. */
  lag: number
}

export interface CpmInput {
  projectStart: Date
  tasks: CpmTaskInput[]
  dependencies: CpmDependencyInput[]
}

export interface CpmTaskResult {
  id: string
  /** Earliest Start (días desde projectStart) */
  ES: number
  /** Earliest Finish (días desde projectStart) */
  EF: number
  /** Latest Start */
  LS: number
  /** Latest Finish */
  LF: number
  /** LS - ES; 0 ⇒ crítica */
  totalFloat: number
  isCritical: boolean
  startDate: Date
  endDate: Date
}

export type CpmWarning =
  | { code: 'CYCLE'; nodes: string[] }
  | { code: 'ORPHAN'; taskId: string }
  | { code: 'NEGATIVE_FLOAT'; taskId: string; float: number }

export interface CpmOutput {
  results: Map<string, CpmTaskResult>
  criticalPath: string[]
  projectDuration: number
  warnings: CpmWarning[]
}

// ────────────────────────── Helpers ──────────────────────────────

function addDaysUTC(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

/**
 * Ordena topológicamente los nodos vía Kahn. Si hay ciclo, retorna
 * `cycleNodes` con los IDs que quedaron con grado > 0 (forman parte
 * de algún ciclo o son sucesores de uno).
 */
function topoSort(
  taskIds: string[],
  adjacency: Map<string, string[]>,
): { order: string[]; cycleNodes: string[] } {
  const indegree = new Map<string, number>()
  for (const id of taskIds) indegree.set(id, 0)
  for (const [, succs] of adjacency) {
    for (const s of succs) {
      indegree.set(s, (indegree.get(s) ?? 0) + 1)
    }
  }
  const queue: string[] = []
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id)
  }
  const order: string[] = []
  while (queue.length) {
    const u = queue.shift() as string
    order.push(u)
    for (const v of adjacency.get(u) ?? []) {
      const d = (indegree.get(v) ?? 0) - 1
      indegree.set(v, d)
      if (d === 0) queue.push(v)
    }
  }
  if (order.length !== taskIds.length) {
    const cycleNodes = taskIds.filter((id) => (indegree.get(id) ?? 0) > 0)
    return { order: [], cycleNodes }
  }
  return { order, cycleNodes: [] }
}

// ────────────────────────── Core API ──────────────────────────────

export function computeCpm(input: CpmInput): CpmOutput {
  const warnings: CpmWarning[] = []
  const taskIds = input.tasks.map((t) => t.id)
  const taskMap = new Map<string, CpmTaskInput>()
  for (const t of input.tasks) taskMap.set(t.id, t)

  // Filtrar deps cuyos extremos existan; reportar el resto como ORPHAN.
  const validDeps: CpmDependencyInput[] = []
  for (const d of input.dependencies) {
    if (!taskMap.has(d.predecessorId)) {
      warnings.push({ code: 'ORPHAN', taskId: d.predecessorId })
      continue
    }
    if (!taskMap.has(d.successorId)) {
      warnings.push({ code: 'ORPHAN', taskId: d.successorId })
      continue
    }
    validDeps.push(d)
  }

  // Adyacencia para topo-sort: predecessor → successor
  const adjacency = new Map<string, string[]>()
  for (const id of taskIds) adjacency.set(id, [])
  for (const d of validDeps) {
    adjacency.get(d.predecessorId)!.push(d.successorId)
  }

  const { order, cycleNodes } = topoSort(taskIds, adjacency)
  if (cycleNodes.length > 0) {
    warnings.push({ code: 'CYCLE', nodes: cycleNodes })
    return {
      results: new Map(),
      criticalPath: [],
      projectDuration: 0,
      warnings,
    }
  }

  // Indexar deps por sucesor (para forward) y por predecesor (para backward).
  const depsBySuccessor = new Map<string, CpmDependencyInput[]>()
  const depsByPredecessor = new Map<string, CpmDependencyInput[]>()
  for (const id of taskIds) {
    depsBySuccessor.set(id, [])
    depsByPredecessor.set(id, [])
  }
  for (const d of validDeps) {
    depsBySuccessor.get(d.successorId)!.push(d)
    depsByPredecessor.get(d.predecessorId)!.push(d)
  }

  // ───── Forward pass: ES, EF ─────
  const ES = new Map<string, number>()
  const EF = new Map<string, number>()
  for (const id of order) {
    const task = taskMap.get(id)!
    const constraint = task.earliestStartConstraint ?? 0
    let es = constraint
    const incoming = depsBySuccessor.get(id) ?? []
    for (const dep of incoming) {
      const pES = ES.get(dep.predecessorId) ?? 0
      const pEF = EF.get(dep.predecessorId) ?? 0
      let candidate: number
      switch (dep.type) {
        case 'FS':
          // succ.ES ≥ pred.EF + lag
          candidate = pEF + dep.lag
          break
        case 'SS':
          // succ.ES ≥ pred.ES + lag
          candidate = pES + dep.lag
          break
        case 'FF':
          // succ.EF ≥ pred.EF + lag → succ.ES = pred.EF + lag - duration
          candidate = pEF + dep.lag - task.duration
          break
        case 'SF':
          // succ.EF ≥ pred.ES + lag → succ.ES = pred.ES + lag - duration
          // (poco usado; PMBOK §6.3.2.1)
          candidate = pES + dep.lag - task.duration
          break
      }
      if (candidate > es) es = candidate
    }
    ES.set(id, es)
    EF.set(id, es + task.duration)
  }

  // Duración total del proyecto = max(EF)
  let projectDuration = 0
  for (const id of taskIds) {
    const ef = EF.get(id) ?? 0
    if (ef > projectDuration) projectDuration = ef
  }

  // ───── Backward pass: LF, LS ─────
  const LF = new Map<string, number>()
  const LS = new Map<string, number>()
  for (const id of taskIds) {
    LF.set(id, projectDuration)
    LS.set(id, projectDuration)
  }
  // Reverso del topo order
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    const task = taskMap.get(id)!
    const outgoing = depsByPredecessor.get(id) ?? []
    let lf: number
    if (outgoing.length === 0) {
      // Tarea final: LF = projectDuration
      lf = projectDuration
    } else {
      lf = Number.POSITIVE_INFINITY
      for (const dep of outgoing) {
        const sLS = LS.get(dep.successorId) ?? projectDuration
        const sLF = LF.get(dep.successorId) ?? projectDuration
        let candidate: number
        switch (dep.type) {
          case 'FS':
            // succ.ES ≥ pred.EF + lag → pred.LF = succ.LS - lag
            candidate = sLS - dep.lag
            break
          case 'SS':
            // succ.ES ≥ pred.ES + lag → pred.LS = succ.LS - lag
            //   ⇒ pred.LF = pred.LS + duration = succ.LS - lag + duration
            candidate = sLS - dep.lag + task.duration
            break
          case 'FF':
            // succ.EF ≥ pred.EF + lag → pred.LF = succ.LF - lag
            candidate = sLF - dep.lag
            break
          case 'SF':
            // succ.EF ≥ pred.ES + lag → pred.LS = succ.LF - lag
            //   ⇒ pred.LF = succ.LF - lag + duration
            candidate = sLF - dep.lag + task.duration
            break
        }
        if (candidate < lf) lf = candidate
      }
      if (!Number.isFinite(lf)) lf = projectDuration
    }
    LF.set(id, lf)
    LS.set(id, lf - task.duration)
  }

  // ───── Construir resultados + ruta crítica ─────
  const results = new Map<string, CpmTaskResult>()
  for (const id of taskIds) {
    const task = taskMap.get(id)!
    const es = ES.get(id) ?? 0
    const ef = EF.get(id) ?? 0
    const ls = LS.get(id) ?? 0
    const lf = LF.get(id) ?? 0
    const totalFloat = ls - es
    if (totalFloat < 0) {
      warnings.push({ code: 'NEGATIVE_FLOAT', taskId: id, float: totalFloat })
    }
    results.set(id, {
      id,
      ES: es,
      EF: ef,
      LS: ls,
      LF: lf,
      totalFloat,
      isCritical: totalFloat === 0,
      startDate: addDaysUTC(input.projectStart, es),
      endDate: addDaysUTC(input.projectStart, ef),
    })
    void task // unused but kept for clarity
  }

  const criticalPath = order.filter((id) => results.get(id)!.isCritical)

  return { results, criticalPath, projectDuration, warnings }
}
