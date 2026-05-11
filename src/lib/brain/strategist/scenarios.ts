/**
 * Wave P19-B · Brain AI Strategist — Predictive scenarios + auto-balancing.
 *
 * Helpers puros para "qué pasa si retraso X días" + sugerencias de
 * re-allocation cross-project. Sin acceso a Prisma — los inputs se
 * preparan en el server action que llama a estos detectores.
 *
 * R3.0-G (PR siguiente) · Módulo restaurado desde commit `6a39403` (PR #184)
 * tras la deuda de coverage detectada en `vitest.config.ts`. Los consumidores
 * de UI (ScenarioPlanner.tsx) + server actions (scenario-actions.ts) siguen
 * desacoplados — se reintroducirán cuando P20-B/C terminen.
 */

// ─── Tipos compartidos ────────────────────────────────────────────────

export interface ScenarioTaskInput {
  id: string
  title: string
  projectId: string
  projectName: string
  startDate: string | null
  endDate: string | null
}

export interface ScenarioDependencyInput {
  /** Predecesor (la task que se retrasa propaga su nuevo endDate al sucesor). */
  predecessorId: string
  successorId: string
  /** Lag en días entre predecesor.end y sucesor.start (puede ser 0 o negativo). */
  lagDays: number
}

export interface AllocationUserInput {
  userId: string
  userName: string
  /** Suma de dailyEffortHours en tasks activas asignadas. */
  totalDailyHours: number
  /** Proyectos involucrados con su SPI. */
  projects: Array<{
    projectId: string
    projectName: string
    spi: number | null
    taskCount: number
  }>
}

// ─── Predictive: simulación de delay ───────────────────────────────────

export interface ScenarioImpact {
  taskId: string
  taskTitle: string
  projectId: string
  projectName: string
  /** Fecha de fin nueva tras la propagación (ISO). */
  newEndDate: string
  /** Días de delta vs. la fecha original. */
  deltaDays: number
  /** Hops desde la task source. 0 = la task original. */
  depth: number
}

export interface ScenarioResult {
  sourceTaskId: string
  sourceTaskTitle: string
  delayDays: number
  /** Tareas afectadas downstream (incluida la source) ordenadas por deltaDays DESC. */
  affected: ScenarioImpact[]
  /** Cuántas tasks de OTROS proyectos resultaron afectadas (cross-project). */
  crossProjectAffected: number
  /** Slipping window: nueva fecha final (max endDate post-shift). */
  newProjectEndDate: string | null
  /** Original project end (max endDate previo al shift). */
  originalProjectEndDate: string | null
}

/**
 * Simula un retraso de `delayDays` en la task `sourceTaskId` y propaga
 * por las dependencias (FS-only, lag respetado). NO modifica los inputs.
 *
 * Algoritmo simple BFS:
 *   1. Marca source con shift = delayDays
 *   2. Para cada sucesor directo de source, calcula nuevo start =
 *      max(start original, source.newEnd + lag). Si > start original,
 *      shift se propaga (deltaDays = newStart - originalStart).
 *   3. Recursión sobre sucesores. Trackea visited para evitar ciclos.
 */
export function simulateDelay(input: {
  sourceTaskId: string
  delayDays: number
  tasks: ScenarioTaskInput[]
  dependencies: ScenarioDependencyInput[]
}): ScenarioResult {
  const { sourceTaskId, delayDays, tasks, dependencies } = input

  const taskById = new Map<string, ScenarioTaskInput>()
  for (const t of tasks) taskById.set(t.id, t)

  const source = taskById.get(sourceTaskId)
  if (!source) {
    return {
      sourceTaskId,
      sourceTaskTitle: '?',
      delayDays,
      affected: [],
      crossProjectAffected: 0,
      newProjectEndDate: null,
      originalProjectEndDate: null,
    }
  }

  // Sucesores indexados por predecessorId.
  const successorsOf = new Map<string, ScenarioDependencyInput[]>()
  for (const d of dependencies) {
    const arr = successorsOf.get(d.predecessorId) ?? []
    arr.push(d)
    successorsOf.set(d.predecessorId, arr)
  }

  const impacts = new Map<string, ScenarioImpact>()
  const queue: Array<{
    taskId: string
    newEndMs: number
    depth: number
  }> = []

  function dateMs(iso: string | null): number | null {
    if (!iso) return null
    const d = new Date(iso).getTime()
    return isNaN(d) ? null : d
  }
  const DAY = 86_400_000

  const sourceEndMs = dateMs(source.endDate)
  if (sourceEndMs == null) {
    return {
      sourceTaskId,
      sourceTaskTitle: source.title,
      delayDays,
      affected: [],
      crossProjectAffected: 0,
      newProjectEndDate: null,
      originalProjectEndDate: null,
    }
  }
  const sourceNewEndMs = sourceEndMs + delayDays * DAY

  impacts.set(source.id, {
    taskId: source.id,
    taskTitle: source.title,
    projectId: source.projectId,
    projectName: source.projectName,
    newEndDate: new Date(sourceNewEndMs).toISOString(),
    deltaDays: delayDays,
    depth: 0,
  })
  queue.push({ taskId: source.id, newEndMs: sourceNewEndMs, depth: 0 })

  let safetyCounter = 0
  while (queue.length > 0 && safetyCounter++ < 5000) {
    const node = queue.shift()!
    const succs = successorsOf.get(node.taskId) ?? []
    for (const dep of succs) {
      const sucTask = taskById.get(dep.successorId)
      if (!sucTask) continue
      const sucStartMs = dateMs(sucTask.startDate)
      const sucEndMs = dateMs(sucTask.endDate)
      if (sucStartMs == null || sucEndMs == null) continue

      const requiredStartMs = node.newEndMs + dep.lagDays * DAY
      // Si la dependencia ya está satisfecha (no necesita moverse), skip.
      if (requiredStartMs <= sucStartMs) continue

      const shiftMs = requiredStartMs - sucStartMs
      const newSucEndMs = sucEndMs + shiftMs
      const deltaDays = Math.ceil(shiftMs / DAY)

      const existing = impacts.get(sucTask.id)
      // Si ya está afectada con un delta mayor, no actualizamos.
      if (existing && existing.deltaDays >= deltaDays) continue

      impacts.set(sucTask.id, {
        taskId: sucTask.id,
        taskTitle: sucTask.title,
        projectId: sucTask.projectId,
        projectName: sucTask.projectName,
        newEndDate: new Date(newSucEndMs).toISOString(),
        deltaDays,
        depth: node.depth + 1,
      })
      queue.push({
        taskId: sucTask.id,
        newEndMs: newSucEndMs,
        depth: node.depth + 1,
      })
    }
  }

  const affected = Array.from(impacts.values()).sort(
    (a, b) => b.deltaDays - a.deltaDays,
  )
  const crossProjectAffected = affected.filter(
    (i) => i.projectId !== source.projectId && i.depth > 0,
  ).length

  const originalEnds = tasks
    .map((t) => dateMs(t.endDate))
    .filter((v): v is number => v != null)
  const originalProjectEndMs =
    originalEnds.length > 0 ? Math.max(...originalEnds) : null

  // newProjectEndDate: max de (endDate original o newEndDate si la task fue afectada).
  let newProjectEndMs = originalProjectEndMs
  for (const i of affected) {
    const ms = new Date(i.newEndDate).getTime()
    if (newProjectEndMs == null || ms > newProjectEndMs) newProjectEndMs = ms
  }

  return {
    sourceTaskId,
    sourceTaskTitle: source.title,
    delayDays,
    affected,
    crossProjectAffected,
    newProjectEndDate:
      newProjectEndMs != null ? new Date(newProjectEndMs).toISOString() : null,
    originalProjectEndDate:
      originalProjectEndMs != null
        ? new Date(originalProjectEndMs).toISOString()
        : null,
  }
}

// ─── Auto-balancing: re-allocation suggestions ────────────────────────

export interface BalanceSuggestion {
  kind: 'overcommitted_user' | 'transfer_load' | 'reassign_to_available'
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  userId: string
  userName: string
  /** Lista corta legible para mostrar al usuario. */
  message: string
  /** Acción sugerida (texto). */
  recommendation: string
  /** Métricas para contexto. */
  metrics: {
    totalDailyHours: number
    projectsInvolved: number
    averageSpi: number | null
  }
}

const OVERCOMMIT_THRESHOLD = 8.5

/**
 * Detecta usuarios sobre-cargados (totalDailyHours > 8.5h) y sugiere
 * cómo balancear:
 *   1. Si está en proyectos con SPI > 1 (sobrados) → mover tasks a
 *      proyectos con SPI < 0.9 (atrasados, necesitan ayuda).
 *   2. Si todos sus proyectos están atrasados → flag overcommit puro,
 *      sugerir reasignar a otro user con disponibilidad.
 */
export function suggestRebalancing(
  users: AllocationUserInput[],
): BalanceSuggestion[] {
  const overcommitted = users.filter(
    (u) => u.totalDailyHours > OVERCOMMIT_THRESHOLD,
  )
  const out: BalanceSuggestion[] = []

  for (const u of overcommitted) {
    const avgSpi =
      u.projects.length > 0
        ? u.projects.map((p) => p.spi ?? 1).reduce((s, n) => s + n, 0) /
          u.projects.length
        : null
    const aheadProjects = u.projects.filter(
      (p) => p.spi != null && p.spi > 1.05,
    )
    const behindProjects = u.projects.filter(
      (p) => p.spi != null && p.spi < 0.95,
    )
    const severity: BalanceSuggestion['severity'] =
      u.totalDailyHours > 12
        ? 'HIGH'
        : u.totalDailyHours > 10
          ? 'MEDIUM'
          : 'LOW'

    const metrics = {
      totalDailyHours: u.totalDailyHours,
      projectsInvolved: u.projects.length,
      averageSpi: avgSpi,
    }

    if (aheadProjects.length > 0 && behindProjects.length > 0) {
      out.push({
        kind: 'transfer_load',
        severity,
        userId: u.userId,
        userName: u.userName,
        message: `${u.userName} sobre-asignado (${u.totalDailyHours.toFixed(1)}h/día) con ${aheadProjects.length} proyecto(s) adelantados y ${behindProjects.length} atrasados.`,
        recommendation: `Considerar mover tareas de "${aheadProjects[0].projectName}" (SPI ${aheadProjects[0].spi?.toFixed(2)}) hacia "${behindProjects[0].projectName}" (SPI ${behindProjects[0].spi?.toFixed(2)}) para acelerar el atrasado.`,
        metrics,
      })
    } else if (behindProjects.length > 0 && aheadProjects.length === 0) {
      out.push({
        kind: 'overcommitted_user',
        severity,
        userId: u.userId,
        userName: u.userName,
        message: `${u.userName} sobre-asignado (${u.totalDailyHours.toFixed(1)}h/día) y TODOS sus proyectos van atrasados.`,
        recommendation: `Reasignar al menos una task a un usuario con disponibilidad, o renegociar fechas con los stakeholders. Riesgo de burnout + delays propagados.`,
        metrics,
      })
    } else {
      out.push({
        kind: 'reassign_to_available',
        severity,
        userId: u.userId,
        userName: u.userName,
        message: `${u.userName} sobre-asignado (${u.totalDailyHours.toFixed(1)}h/día).`,
        recommendation: `Identificar usuarios con disponibilidad (totalDailyHours < 6h) y transferir parcialmente la carga.`,
        metrics,
      })
    }
  }

  // Ordenar por severity DESC y luego por horas DESC.
  const sevOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const
  out.sort((a, b) => {
    const s = sevOrder[b.severity] - sevOrder[a.severity]
    if (s !== 0) return s
    return b.metrics.totalDailyHours - a.metrics.totalDailyHours
  })
  return out
}
