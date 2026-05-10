'use server'

/**
 * Wave P19-A · Brain AI Strategist — Server actions cross-project.
 *
 * Carga datos cross-project en bulk, ejecuta los 3 detectores puros y
 * devuelve los insights consolidados. MVP sin persistencia: cada visita
 * regenera (cheaper que persistir y mantener fresh).
 */

import prisma from '@/lib/prisma'
import {
  detectResourceContention,
  detectDependencyConflicts,
  detectReusableLessons,
  type StrategistTaskInput,
  type StrategistCrossDepInput,
  type StrategistLessonInput,
  type ResourceContentionInsight,
  type DependencyConflictInsight,
  type ReusableLessonInsight,
} from './detectors'

export interface StrategistReport {
  resourceContention: ResourceContentionInsight[]
  dependencyConflicts: DependencyConflictInsight[]
  reusableLessons: ReusableLessonInsight[]
  generatedAt: string
  scanned: {
    activeProjects: number
    tasks: number
    crossDeps: number
    lessons: number
  }
}

export async function loadStrategistReport(): Promise<StrategistReport> {
  // Solo proyectos activos / planning (no archivados).
  const projects = await prisma.project.findMany({
    where: { OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }] },
    select: { id: true, name: true },
  })
  const projectIds = projects.map((p) => p.id)
  const activeProjectNames = projects.map((p) => p.name)

  // Tasks de esos proyectos con asignación + fechas.
  const taskRows = await prisma.task.findMany({
    where: {
      projectId: { in: projectIds },
      archivedAt: null,
      assigneeId: { not: null },
      startDate: { not: null },
      endDate: { not: null },
    },
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { name: true } },
      assigneeId: true,
      assignee: { select: { name: true } },
      startDate: true,
      endDate: true,
      dailyEffortHours: true,
      status: true,
    },
  })

  const tasks: StrategistTaskInput[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    projectName: t.project?.name ?? '—',
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.name ?? null,
    startDate: t.startDate?.toISOString() ?? null,
    endDate: t.endDate?.toISOString() ?? null,
    dailyEffortHours: t.dailyEffortHours ?? null,
    status: t.status,
  }))

  // Cross-project dependencies (Wave P10 HU-10.4). Source = predecessor,
  // target = successor en la convención del repo.
  const crossDepRows = await prisma.crossProjectDependency.findMany({
    select: {
      sourceTaskId: true,
      targetTaskId: true,
      sourceTask: {
        select: {
          title: true,
          endDate: true,
          project: { select: { name: true } },
        },
      },
      targetTask: {
        select: {
          title: true,
          startDate: true,
          project: { select: { name: true } },
        },
      },
    },
  })

  const crossDeps: StrategistCrossDepInput[] = crossDepRows.map((d) => ({
    predecessorTaskId: d.sourceTaskId,
    predecessorTitle: d.sourceTask?.title ?? '—',
    predecessorProjectName: d.sourceTask?.project?.name ?? '—',
    predecessorEndDate: d.sourceTask?.endDate?.toISOString() ?? null,
    successorTaskId: d.targetTaskId,
    successorTitle: d.targetTask?.title ?? '—',
    successorProjectName: d.targetTask?.project?.name ?? '—',
    successorStartDate: d.targetTask?.startDate?.toISOString() ?? null,
  }))

  // Lessons learned cross-project.
  const lessonRows = await prisma.lessonLearned.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      projectId: true,
      project: { select: { name: true } },
      category: true,
      title: true,
      recommendation: true,
    },
  })

  const lessons: StrategistLessonInput[] = lessonRows.map((l) => ({
    projectId: l.projectId,
    projectName: l.project?.name ?? '—',
    category: String(l.category),
    title: l.title,
    recommendation: l.recommendation,
  }))

  return {
    resourceContention: detectResourceContention(tasks),
    dependencyConflicts: detectDependencyConflicts(crossDeps),
    reusableLessons: detectReusableLessons(lessons, activeProjectNames),
    generatedAt: new Date().toISOString(),
    scanned: {
      activeProjects: projects.length,
      tasks: tasks.length,
      crossDeps: crossDeps.length,
      lessons: lessons.length,
    },
  }
}
