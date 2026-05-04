/**
 * Ola P5 · Equipo P5-3 · Reportes ejecutivos
 *
 * Status report semanal: agregaciones puras (sin Prisma) sobre snapshots
 * de tareas / hitos / proyecto. La capa server action (`reports.ts`) carga
 * los datos y delega los cálculos aquí para que sean testeables sin BD.
 */

export type StatusTaskInput = {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
  isMilestone: boolean
  startDate: Date | null
  endDate: Date | null
  progress: number
  assigneeName: string | null
}

export type StatusReportData = {
  projectId: string
  projectName: string
  weekOfYear: string // formato "2026-W18"
  periodStart: string // ISO date (lunes)
  periodEnd: string // ISO date (domingo)
  generatedAt: string // ISO timestamp
  summary: {
    totalTasks: number
    completedTasks: number
    progressPercent: number // 0..100
    upcomingMilestones: Array<{
      id: string
      title: string
      endDate: string // ISO
      daysUntil: number
    }>
  }
  criticalPath: Array<{
    id: string
    title: string
    startDate: string | null
    endDate: string | null
    progress: number
    owner: string | null
  }>
  delayedTasks: Array<{
    id: string
    title: string
    endDate: string | null
    daysOverdue: number
    progress: number
    owner: string | null
  }>
  // Top-5 riesgos abiertos (placeholder hasta que exista módulo de riesgos).
  topRisks: Array<{
    id: string
    title: string
    severity: 'low' | 'medium' | 'high'
    description: string
  }>
}

const MS_PER_DAY = 86_400_000

/**
 * Devuelve la semana ISO 8601 (lunes-domingo) de la fecha dada con formato
 * `YYYY-Www`. Algoritmo estándar: el jueves de cada semana cae siempre en la
 * misma "year-week".
 */
export function isoWeekOfYear(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const dayNum = d.getUTCDay() || 7 // 1..7 con lunes=1 domingo=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7,
  )
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/**
 * Devuelve [lunes, domingo] (UTC) de la semana que contiene `date`.
 */
export function weekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
  const dayNum = d.getUTCDay() || 7
  const start = new Date(d.getTime() - (dayNum - 1) * MS_PER_DAY)
  const end = new Date(start.getTime() + 6 * MS_PER_DAY)
  return { start, end }
}

export function diffDaysUTC(a: Date, b: Date): number {
  const aUTC = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const bUTC = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.round((bUTC - aUTC) / MS_PER_DAY)
}

export function computeStatusSummary(
  tasks: StatusTaskInput[],
  now: Date = new Date(),
): StatusReportData['summary'] {
  const totalTasks = tasks.length
  let completedTasks = 0
  let progressSum = 0

  for (const t of tasks) {
    if (t.status === 'DONE') completedTasks += 1
    progressSum += t.progress
  }

  const progressPercent =
    totalTasks > 0 ? Math.round(progressSum / totalTasks) : 0

  const upcomingMilestones = tasks
    .filter(
      (t) =>
        t.isMilestone &&
        t.status !== 'DONE' &&
        t.endDate != null &&
        diffDaysUTC(now, t.endDate) >= 0 &&
        diffDaysUTC(now, t.endDate) <= 7,
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      endDate: (t.endDate as Date).toISOString(),
      daysUntil: diffDaysUTC(now, t.endDate as Date),
    }))
    .sort((a, b) => a.daysUntil - b.daysUntil)

  return { totalTasks, completedTasks, progressPercent, upcomingMilestones }
}

export function computeDelayedTasks(
  tasks: StatusTaskInput[],
  now: Date = new Date(),
): StatusReportData['delayedTasks'] {
  return tasks
    .filter(
      (t) =>
        t.status !== 'DONE' &&
        t.endDate != null &&
        t.endDate.getTime() < now.getTime(),
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      endDate: t.endDate ? t.endDate.toISOString() : null,
      daysOverdue: diffDaysUTC(t.endDate as Date, now),
      progress: t.progress,
      owner: t.assigneeName,
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
}

/**
 * Filtra las tareas pertenecientes al critical path y las devuelve
 * ordenadas por startDate. Las owner-less mantienen `null`.
 */
export function filterCriticalPath(
  tasks: StatusTaskInput[],
  criticalIds: ReadonlyArray<string>,
): StatusReportData['criticalPath'] {
  const set = new Set(criticalIds)
  return tasks
    .filter((t) => set.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      startDate: t.startDate ? t.startDate.toISOString() : null,
      endDate: t.endDate ? t.endDate.toISOString() : null,
      progress: t.progress,
      owner: t.assigneeName,
    }))
    .sort((a, b) => {
      if (!a.startDate) return 1
      if (!b.startDate) return -1
      return a.startDate.localeCompare(b.startDate)
    })
}

export function buildStatusReport(input: {
  projectId: string
  projectName: string
  tasks: StatusTaskInput[]
  criticalPathIds: ReadonlyArray<string>
  now?: Date
}): StatusReportData {
  const now = input.now ?? new Date()
  const summary = computeStatusSummary(input.tasks, now)
  const delayedTasks = computeDelayedTasks(input.tasks, now)
  const criticalPath = filterCriticalPath(input.tasks, input.criticalPathIds)
  const range = weekRange(now)

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    weekOfYear: isoWeekOfYear(now),
    periodStart: range.start.toISOString(),
    periodEnd: range.end.toISOString(),
    generatedAt: now.toISOString(),
    summary,
    criticalPath,
    delayedTasks,
    // Placeholder hasta que exista módulo de riesgos. La UI muestra un
    // mensaje "No hay módulo de riesgos integrado aún".
    topRisks: [],
  }
}
