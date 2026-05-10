'use server'

/**
 * Wave P19-B · Server actions para Predictive Scenarios + Auto-balancing.
 */

import prisma from '@/lib/prisma'
import {
  simulateDelay,
  suggestRebalancing,
  type ScenarioTaskInput,
  type ScenarioDependencyInput,
  type AllocationUserInput,
  type ScenarioResult,
  type BalanceSuggestion,
} from './scenarios'

export interface SimulateDelayInput {
  sourceTaskId: string
  delayDays: number
}

/**
 * Simula retraso en una task y propaga por dependencias.
 * Carga las dependencias INTRA-proyecto + CROSS-project del proyecto
 * source para que la propagación cubra el portfolio.
 */
export async function simulateTaskDelay(
  input: SimulateDelayInput,
): Promise<ScenarioResult> {
  if (!input.sourceTaskId) throw new Error('[INVALID_INPUT] sourceTaskId requerido')
  if (typeof input.delayDays !== 'number' || input.delayDays === 0) {
    throw new Error('[INVALID_INPUT] delayDays debe ser un número distinto de 0')
  }

  const sourceTask = await prisma.task.findUnique({
    where: { id: input.sourceTaskId },
    select: { id: true, projectId: true },
  })
  if (!sourceTask) throw new Error('[NOT_FOUND] task no existe')

  // Cargamos todas las tasks de los proyectos vinculados a la source via
  // cross-deps + el propio proyecto. Esto cubre la propagación cross-project.
  const crossDeps = await prisma.crossProjectDependency.findMany({
    select: {
      sourceTaskId: true,
      targetTaskId: true,
      lagDays: true,
      sourceTask: { select: { projectId: true } },
      targetTask: { select: { projectId: true } },
    },
  })

  const involvedProjectIds = new Set<string>([sourceTask.projectId])
  for (const d of crossDeps) {
    if (d.sourceTaskId === input.sourceTaskId || d.targetTaskId === input.sourceTaskId) {
      if (d.sourceTask?.projectId) involvedProjectIds.add(d.sourceTask.projectId)
      if (d.targetTask?.projectId) involvedProjectIds.add(d.targetTask.projectId)
    }
  }

  const [tasks, intraDeps] = await Promise.all([
    prisma.task.findMany({
      where: { projectId: { in: Array.from(involvedProjectIds) }, archivedAt: null },
      select: {
        id: true,
        title: true,
        projectId: true,
        project: { select: { name: true } },
        startDate: true,
        endDate: true,
      },
    }),
    prisma.taskDependency.findMany({
      where: {
        predecessor: { projectId: { in: Array.from(involvedProjectIds) } },
      },
      select: { predecessorId: true, successorId: true, lagDays: true },
    }),
  ])

  const taskInputs: ScenarioTaskInput[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    projectName: t.project?.name ?? '—',
    startDate: t.startDate?.toISOString() ?? null,
    endDate: t.endDate?.toISOString() ?? null,
  }))

  const deps: ScenarioDependencyInput[] = [
    ...intraDeps.map((d) => ({
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      lagDays: d.lagDays ?? 0,
    })),
    ...crossDeps.map((d) => ({
      predecessorId: d.sourceTaskId,
      successorId: d.targetTaskId,
      lagDays: d.lagDays ?? 0,
    })),
  ]

  return simulateDelay({
    sourceTaskId: input.sourceTaskId,
    delayDays: input.delayDays,
    tasks: taskInputs,
    dependencies: deps,
  })
}

/**
 * Calcula sugerencias de auto-balancing inspeccionando carga diaria de
 * cada user en sus tasks activas + SPI de los proyectos involucrados
 * (vía último EVMSnapshot).
 */
export async function loadBalancingSuggestions(): Promise<BalanceSuggestion[]> {
  // Tasks activas con assignee + dailyEffortHours + projectId.
  const activeTasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      status: { not: 'DONE' },
      assigneeId: { not: null },
      dailyEffortHours: { not: null, gt: 0 },
    },
    select: {
      assigneeId: true,
      assignee: { select: { name: true } },
      projectId: true,
      project: { select: { name: true } },
      dailyEffortHours: true,
    },
  })

  // Último SPI por proyecto.
  const projectIds = Array.from(new Set(activeTasks.map((t) => t.projectId)))
  const snapshots = await prisma.eVMSnapshot.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: { snapshotDate: 'desc' },
    select: { projectId: true, spi: true },
  })
  const spiByProject = new Map<string, number | null>()
  for (const s of snapshots) {
    if (!spiByProject.has(s.projectId)) spiByProject.set(s.projectId, s.spi ?? null)
  }

  // Agrupar por user.
  const byUser = new Map<string, AllocationUserInput>()
  for (const t of activeTasks) {
    if (!t.assigneeId) continue
    const entry = byUser.get(t.assigneeId) ?? {
      userId: t.assigneeId,
      userName: t.assignee?.name ?? t.assigneeId,
      totalDailyHours: 0,
      projects: [],
    }
    entry.totalDailyHours += t.dailyEffortHours ?? 0
    const projEntry = entry.projects.find((p) => p.projectId === t.projectId)
    if (projEntry) {
      projEntry.taskCount += 1
    } else {
      entry.projects.push({
        projectId: t.projectId,
        projectName: t.project?.name ?? '—',
        spi: spiByProject.get(t.projectId) ?? null,
        taskCount: 1,
      })
    }
    byUser.set(t.assigneeId, entry)
  }

  return suggestRebalancing(Array.from(byUser.values()))
}

/**
 * Helper que carga las tasks de un proyecto para popular el dropdown
 * del scenario builder. Solo info mínima.
 */
export async function listTasksForScenario(input: {
  projectId: string
}): Promise<Array<{ id: string; title: string; mnemonic: string | null; endDate: string | null }>> {
  if (!input.projectId) return []
  const tasks = await prisma.task.findMany({
    where: {
      projectId: input.projectId,
      archivedAt: null,
      status: { not: 'DONE' },
      endDate: { not: null },
    },
    select: { id: true, title: true, mnemonic: true, endDate: true },
    orderBy: { endDate: 'asc' },
    take: 200,
  })
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    mnemonic: t.mnemonic,
    endDate: t.endDate?.toISOString() ?? null,
  }))
}
