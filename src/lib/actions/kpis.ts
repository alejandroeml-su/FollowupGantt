'use server'

import prisma from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import {
  type KPIBundle,
  type KPIFilterOptions,
  type KPIFilters,
  classifyIndex,
  classifyPlannedVsActual,
  classifyROI,
  classifyScopeCreep,
  classifySuccessRate,
  classifyUtilization,
  classifyVariance,
  computeEVMTotals,
  lastNMonths,
  monthKey,
} from '@/lib/kpi-calc'

function buildTaskWhere(filters: KPIFilters): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = { archivedAt: null }

  if (filters.status) where.status = filters.status
  if (filters.type) where.type = filters.type
  if (filters.assigneeId) where.assigneeId = filters.assigneeId
  if (filters.projectId) where.projectId = filters.projectId

  if (filters.areaId) {
    where.project = { areaId: filters.areaId }
  } else if (filters.gerenciaId) {
    where.project = { area: { gerenciaId: filters.gerenciaId } }
  }
  return where
}

function buildProjectWhere(filters: KPIFilters): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = {}
  if (filters.projectId) where.id = filters.projectId
  if (filters.areaId) where.areaId = filters.areaId
  else if (filters.gerenciaId) where.area = { gerenciaId: filters.gerenciaId }
  return where
}

export async function getKPIFilterOptions(): Promise<KPIFilterOptions> {
  const [gerencias, areas, projects, users] = await Promise.all([
    prisma.gerencia.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.area.findMany({
      select: { id: true, name: true, gerenciaId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.project.findMany({
      select: { id: true, name: true, areaId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])
  return { gerencias, areas, projects, users }
}

export async function getPortfolioKPIs(filters: KPIFilters = {}): Promise<KPIBundle> {
  const taskWhere = buildTaskWhere(filters)
  const projectWhere = buildProjectWhere(filters)

  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({
      where: taskWhere,
      select: {
        id: true,
        status: true,
        progress: true,
        plannedValue: true,
        actualCost: true,
        earnedValue: true,
        assigneeId: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        projectId: true,
      },
    }),
    prisma.project.findMany({
      where: projectWhere,
      select: {
        id: true,
        status: true,
        createdAt: true,
        tasks: {
          where: { archivedAt: null },
          select: {
            id: true,
            plannedValue: true,
            actualCost: true,
            progress: true,
            endDate: true,
            createdAt: true,
          },
        },
      },
    }),
  ])

  const { pv, ev, ac } = computeEVMTotals(tasks)
  const sv = ev - pv
  const cv = ev - ac
  const cpi = ac > 0 ? ev / ac : null
  const spi = pv > 0 ? ev / pv : null
  const roi = ac > 0 ? ((ev - ac) / ac) * 100 : null

  const completed = projects.filter((p) => p.status === 'COMPLETED')
  let successfulProjects = 0
  for (const p of completed) {
    const totals = computeEVMTotals(
      p.tasks.map((t) => ({
        plannedValue: t.plannedValue,
        actualCost: t.actualCost,
        earnedValue: null,
        progress: t.progress,
      })),
    )
    const projCPI = totals.ac > 0 ? totals.ev / totals.ac : 1
    const projSPI = totals.pv > 0 ? totals.ev / totals.pv : 1
    if (projCPI >= 0.95 && projSPI >= 0.95) successfulProjects += 1
  }
  const successRateValue = completed.length > 0 ? (successfulProjects / completed.length) * 100 : null

  const activeTasks = tasks.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'DONE')
  const activePV = activeTasks.reduce((a, t) => a + (t.plannedValue ?? 0), 0)
  const activeAC = activeTasks.reduce((a, t) => a + (t.actualCost ?? 0), 0)
  const utilizationValue = activePV > 0 ? (activeAC / activePV) * 100 : null

  const projectStarts = new Map(projects.map((p) => [p.id, p.createdAt]))
  let creepTasks = 0
  let baselineCount = 0
  for (const t of tasks) {
    const projStart = projectStarts.get(t.projectId)
    if (!projStart) continue
    baselineCount += 1
    const diffDays = (t.createdAt.getTime() - projStart.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays > 7) creepTasks += 1
  }
  const scopeCreepValue = baselineCount > 0 ? (creepTasks / baselineCount) * 100 : null

  const now = new Date()
  const plannedToDate = tasks.filter((t) => t.endDate && t.endDate <= now).length
  const actualDone = tasks.filter((t) => t.status === 'DONE').length
  const pvaRatio = plannedToDate > 0 ? (actualDone / plannedToDate) * 100 : null

  const months = lastNMonths(6)
  const trendMap = new Map<string, { pv: number; ev: number; ac: number }>()
  months.forEach((m) => trendMap.set(m, { pv: 0, ev: 0, ac: 0 }))

  for (const t of tasks) {
    const k = monthKey(t.createdAt)
    const bucket = trendMap.get(k)
    if (!bucket) continue
    const taskPV = t.plannedValue ?? 0
    const taskAC = t.actualCost ?? 0
    const taskEV = t.earnedValue ?? taskPV * ((t.progress ?? 0) / 100)
    bucket.pv += taskPV
    bucket.ev += taskEV
    bucket.ac += taskAC
  }
  const trend = months.map((m) => ({ month: m, ...trendMap.get(m)! }))

  const totals = {
    projects: projects.length,
    tasks: tasks.length,
    completedTasks: actualDone,
    activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
  }

  return {
    pv,
    ev,
    ac,
    sv: classifyVariance(sv, pv, 'schedule'),
    cv: classifyVariance(cv, pv, 'cost'),
    cpi: classifyIndex(cpi, 'cpi'),
    spi: classifyIndex(spi, 'spi'),
    roi: classifyROI(roi),
    successRate: classifySuccessRate(successRateValue),
    resourceUtilization: classifyUtilization(utilizationValue),
    scopeCreep: classifyScopeCreep(scopeCreepValue),
    plannedVsActual: {
      planned: plannedToDate,
      actual: actualDone,
      ratio: classifyPlannedVsActual(pvaRatio),
    },
    trend,
    totals,
  }
}
