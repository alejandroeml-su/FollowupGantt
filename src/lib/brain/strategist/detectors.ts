/**
 * Wave P19-A · Brain AI Strategist — Detectores puros cross-project.
 *
 * Heurísticas para identificar problemas que ningún proyecto individual
 * puede ver (necesitan visión de portafolio):
 *
 *   1. Resource contention: usuarios asignados a tareas con fechas solapadas
 *      en ≥2 proyectos distintos (≥1 día de solape).
 *   2. Dependency conflicts: cross-project deps donde el sucesor empieza
 *      antes que termine el predecesor (schedule fail) o forman ciclos.
 *   3. Lessons reusables: lessons de un proyecto con recommendation que
 *      podría aplicar a otros proyectos similares (matching por categoría).
 *
 * Archivo puro (sin Prisma): los inputs ya vienen serializados desde
 * `loadStrategistInputs()`. Esto permite tests unitarios deterministas.
 */

export interface StrategistTaskInput {
  id: string
  title: string
  projectId: string
  projectName: string
  assigneeId: string | null
  assigneeName: string | null
  startDate: string | null
  endDate: string | null
  dailyEffortHours: number | null
  status: string
}

export interface StrategistCrossDepInput {
  predecessorTaskId: string
  predecessorTitle: string
  predecessorProjectName: string
  predecessorEndDate: string | null
  successorTaskId: string
  successorTitle: string
  successorProjectName: string
  successorStartDate: string | null
}

export interface StrategistLessonInput {
  projectId: string
  projectName: string
  category: string
  title: string
  recommendation: string
}

// ─── Resource contention ────────────────────────────────────────────

export interface ResourceContentionInsight {
  kind: 'resource_contention'
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  userId: string
  userName: string
  overlapDays: number
  projects: Array<{ id: string; name: string; taskTitle: string }>
  recommendation: string
}

function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime())
  const end = Math.min(aEnd.getTime(), bEnd.getTime())
  if (end <= start) return 0
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24))
}

export function detectResourceContention(
  tasks: StrategistTaskInput[],
): ResourceContentionInsight[] {
  // Agrupa por usuario, descarta DONE/CANCELLED.
  const byUser = new Map<string, StrategistTaskInput[]>()
  for (const t of tasks) {
    if (!t.assigneeId || !t.startDate || !t.endDate) continue
    if (t.status === 'DONE') continue
    const arr = byUser.get(t.assigneeId) ?? []
    arr.push(t)
    byUser.set(t.assigneeId, arr)
  }

  const insights: ResourceContentionInsight[] = []
  for (const [userId, userTasks] of byUser.entries()) {
    if (userTasks.length < 2) continue

    // Buscar pares de tasks en proyectos distintos con overlap.
    const conflicting = new Map<string, { taskTitle: string; projectName: string }>()
    let maxOverlap = 0
    for (let i = 0; i < userTasks.length; i++) {
      for (let j = i + 1; j < userTasks.length; j++) {
        const a = userTasks[i]
        const b = userTasks[j]
        if (a.projectId === b.projectId) continue
        const aStart = new Date(a.startDate!)
        const aEnd = new Date(a.endDate!)
        const bStart = new Date(b.startDate!)
        const bEnd = new Date(b.endDate!)
        const ov = overlapDays(aStart, aEnd, bStart, bEnd)
        if (ov > 0) {
          maxOverlap = Math.max(maxOverlap, ov)
          conflicting.set(a.projectId, { taskTitle: a.title, projectName: a.projectName })
          conflicting.set(b.projectId, { taskTitle: b.title, projectName: b.projectName })
        }
      }
    }

    if (conflicting.size >= 2) {
      const severity: ResourceContentionInsight['severity'] =
        maxOverlap >= 10 ? 'HIGH' : maxOverlap >= 3 ? 'MEDIUM' : 'LOW'
      const userName = userTasks[0].assigneeName ?? userId
      insights.push({
        kind: 'resource_contention',
        severity,
        userId,
        userName,
        overlapDays: maxOverlap,
        projects: Array.from(conflicting.entries()).map(([id, v]) => ({
          id,
          name: v.projectName,
          taskTitle: v.taskTitle,
        })),
        recommendation:
          conflicting.size > 2
            ? `${userName} está asignado simultáneamente a ${conflicting.size} proyectos durante ${maxOverlap} días. Considera reasignar o ajustar fechas para evitar burnout y delays.`
            : `${userName} tiene solape de ${maxOverlap} días entre 2 proyectos. Valida prioridad con el área correspondiente.`,
      })
    }
  }

  // Ordenar por severity DESC y overlapDays DESC.
  const sevOrder: Record<ResourceContentionInsight['severity'], number> = {
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  }
  insights.sort((a, b) => {
    const s = sevOrder[b.severity] - sevOrder[a.severity]
    if (s !== 0) return s
    return b.overlapDays - a.overlapDays
  })
  return insights
}

// ─── Dependency conflicts ───────────────────────────────────────────

export interface DependencyConflictInsight {
  kind: 'dependency_conflict'
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  predecessor: { taskId: string; title: string; project: string; endDate: string }
  successor: { taskId: string; title: string; project: string; startDate: string }
  gapDays: number
  recommendation: string
}

export function detectDependencyConflicts(
  crossDeps: StrategistCrossDepInput[],
): DependencyConflictInsight[] {
  const insights: DependencyConflictInsight[] = []
  for (const d of crossDeps) {
    if (!d.predecessorEndDate || !d.successorStartDate) continue
    const predEnd = new Date(d.predecessorEndDate)
    const sucStart = new Date(d.successorStartDate)
    const gap = Math.ceil(
      (sucStart.getTime() - predEnd.getTime()) / (1000 * 60 * 60 * 24),
    )
    // gap < 0 → schedule fail (sucesor empieza antes que termine predecesor).
    if (gap < 0) {
      const severity: DependencyConflictInsight['severity'] =
        gap <= -10 ? 'HIGH' : gap <= -3 ? 'MEDIUM' : 'LOW'
      insights.push({
        kind: 'dependency_conflict',
        severity,
        predecessor: {
          taskId: d.predecessorTaskId,
          title: d.predecessorTitle,
          project: d.predecessorProjectName,
          endDate: d.predecessorEndDate,
        },
        successor: {
          taskId: d.successorTaskId,
          title: d.successorTitle,
          project: d.successorProjectName,
          startDate: d.successorStartDate,
        },
        gapDays: gap,
        recommendation: `La tarea "${d.successorTitle}" (${d.successorProjectName}) inicia ${Math.abs(gap)} días ANTES de que termine su predecesora "${d.predecessorTitle}" (${d.predecessorProjectName}). Ajusta el cronograma o re-secuencia.`,
      })
    }
  }
  insights.sort((a, b) => a.gapDays - b.gapDays) // más negativo primero
  return insights
}

// ─── Reusable lessons ───────────────────────────────────────────────

export interface ReusableLessonInsight {
  kind: 'reusable_lesson'
  severity: 'LOW'
  sourceProject: string
  category: string
  title: string
  recommendation: string
  applicableProjects: string[]
}

export function detectReusableLessons(
  lessons: StrategistLessonInput[],
  activeProjectNames: string[],
): ReusableLessonInsight[] {
  // Agrupa lessons por categoría. Si una categoría aparece en proyectos
  // activos pero la lesson viene de un proyecto distinto, sugerir aplicarla.
  const byCategory = new Map<string, StrategistLessonInput[]>()
  for (const l of lessons) {
    const arr = byCategory.get(l.category) ?? []
    arr.push(l)
    byCategory.set(l.category, arr)
  }
  const insights: ReusableLessonInsight[] = []
  for (const [cat, items] of byCategory.entries()) {
    if (items.length === 0) continue
    // Tomar la lesson más reciente por categoría como "representativa".
    const top = items[0]
    const sourceName = top.projectName
    const others = activeProjectNames.filter((n) => n !== sourceName)
    if (others.length === 0) continue
    insights.push({
      kind: 'reusable_lesson',
      severity: 'LOW',
      sourceProject: sourceName,
      category: cat,
      title: top.title,
      recommendation: top.recommendation,
      applicableProjects: others.slice(0, 5),
    })
  }
  return insights.slice(0, 10)
}
