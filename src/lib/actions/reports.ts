'use server'

import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { requireUser } from '@/lib/auth/get-current-user'
import { hasAdminRole, ROLE_NAMES } from '@/lib/auth/permissions'
import { computeCpm } from '@/lib/scheduling/cpm'
import { loadCpmInputForProject } from '@/lib/scheduling/prismaAdapter'
import { computeEVM, type EVMResult } from '@/lib/reports/evm'
import {
  buildStatusReport,
  type StatusReportData,
  type StatusTaskInput,
} from '@/lib/reports/status-report'
import {
  buildPortfolioReport,
  type PortfolioProjectInput,
  type PortfolioReport,
} from '@/lib/reports/portfolio'

/**
 * Ola P5 · Equipo P5-3 · Server Actions de Reportes
 *
 * Errores tipados:
 *   - [UNAUTHORIZED]      sesión faltante (delegado a auth helpers).
 *   - [FORBIDDEN]         sin acceso al proyecto / sin rol PM+.
 *   - [NOT_FOUND]         projectId no existe.
 *   - [INSUFFICIENT_DATA] cuando no hay datos suficientes para EVM (re-throw).
 */

const MS_PER_DAY = 86_400_000

function actionError(
  code: 'NOT_FOUND' | 'FORBIDDEN' | 'UNAUTHORIZED',
  detail: string,
): never {
  throw new Error(`[${code}] ${detail}`)
}

function diffDaysUTC(a: Date, b: Date): number {
  const aUTC = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const bUTC = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.round((bUTC - aUTC) / MS_PER_DAY)
}

/**
 * Carga el snapshot completo de tareas + project meta para el reporte.
 * Reutilizado por status / EVM para evitar dos round-trips.
 */
async function loadProjectSnapshot(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      status: true,
    },
  })
  if (!project) actionError('NOT_FOUND', `Proyecto ${projectId} no existe`)

  const tasks = await prisma.task.findMany({
    where: { projectId, archivedAt: null },
    select: {
      id: true,
      title: true,
      status: true,
      progress: true,
      isMilestone: true,
      startDate: true,
      endDate: true,
      plannedValue: true,
      actualCost: true,
      earnedValue: true,
      assignee: { select: { name: true } },
    },
  })

  return { project, tasks }
}

export type StatusReportPayload = StatusReportData & {
  project: { id: string; name: string; status: string }
}

export async function getStatusReport(
  projectId: string,
): Promise<StatusReportPayload> {
  if (!projectId) actionError('NOT_FOUND', 'projectId requerido')
  await requireProjectAccess(projectId)

  const { project, tasks } = await loadProjectSnapshot(projectId)

  // Mapeo defensivo: status sólo admite los 4 valores; el cast es seguro
  // porque Prisma garantiza la enum en runtime.
  const statusTasks: StatusTaskInput[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status as StatusTaskInput['status'],
    isMilestone: t.isMilestone,
    startDate: t.startDate,
    endDate: t.endDate,
    progress: t.progress,
    assigneeName: t.assignee?.name ?? null,
  }))

  // CPM puede fallar (ciclos, sin tareas con fechas) — capturamos para
  // que el reporte no se rompa: simplemente no muestra críticas.
  let criticalIds: string[] = []
  try {
    const cpmInput = await loadCpmInputForProject(projectId)
    const cpm = computeCpm(cpmInput)
    criticalIds = cpm.criticalPath
  } catch {
    criticalIds = []
  }

  const data = buildStatusReport({
    projectId: project.id,
    projectName: project.name,
    tasks: statusTasks,
    criticalPathIds: criticalIds,
  })

  return {
    ...data,
    project: { id: project.id, name: project.name, status: project.status },
  }
}

export type EVMReportPayload = {
  project: { id: string; name: string; status: string }
  evm: EVMResult
}

export async function getEVMReport(
  projectId: string,
): Promise<EVMReportPayload> {
  if (!projectId) actionError('NOT_FOUND', 'projectId requerido')
  await requireProjectAccess(projectId)

  const { project, tasks } = await loadProjectSnapshot(projectId)

  const evmInput = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    plannedValue: t.plannedValue,
    actualCost: t.actualCost,
    earnedValue: t.earnedValue,
    progress: t.progress,
    startDate: t.startDate,
    endDate: t.endDate,
  }))

  const evm = computeEVM(evmInput)

  return {
    project: { id: project.id, name: project.name, status: project.status },
    evm,
  }
}

/**
 * Portfolio: requiere rol PM+ (SUPER_ADMIN / ADMIN). El concepto "PM" en el
 * MVP de Auth no es un rol distinto; los admins son los únicos con visión
 * cross-project. Si en el futuro existe rol PM, se añade aquí.
 */
async function requirePortfolioAccess() {
  const user = await requireUser()
  // Admins siempre. Si no, falla.
  if (hasAdminRole(user.roles)) return user
  // Hook futuro: si user.roles incluye 'PM' también permitir.
  if (user.roles.includes('PM')) return user
  actionError('FORBIDDEN', `Se requiere rol ${ROLE_NAMES.ADMIN} o PM`)
}

export async function getPortfolioReport(): Promise<PortfolioReport> {
  await requirePortfolioAccess()

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      tasks: {
        where: { archivedAt: null },
        select: {
          id: true,
          title: true,
          status: true,
          progress: true,
          isMilestone: true,
          startDate: true,
          endDate: true,
          plannedValue: true,
          actualCost: true,
          earnedValue: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })

  const now = new Date()
  const inputs: PortfolioProjectInput[] = projects.map((p) => {
    const totalTasks = p.tasks.length
    let completedTasks = 0
    let progressSum = 0
    let nextMilestone: PortfolioProjectInput['nextMilestone'] = null
    for (const t of p.tasks) {
      if (t.status === 'DONE') completedTasks += 1
      progressSum += t.progress
      if (
        t.isMilestone &&
        t.status !== 'DONE' &&
        t.endDate != null &&
        t.endDate.getTime() >= now.getTime()
      ) {
        const days = diffDaysUTC(now, t.endDate)
        if (!nextMilestone || days < nextMilestone.daysUntil) {
          nextMilestone = {
            id: t.id,
            title: t.title,
            endDate: t.endDate.toISOString(),
            daysUntil: days,
          }
        }
      }
    }

    let evm: EVMResult | null = null
    try {
      evm = computeEVM(
        p.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          plannedValue: t.plannedValue,
          actualCost: t.actualCost,
          earnedValue: t.earnedValue,
          progress: t.progress,
          startDate: t.startDate,
          endDate: t.endDate,
        })),
        now,
      )
    } catch {
      // Insuficiente data o input inválido: el portfolio lo marca como gray.
      evm = null
    }

    return {
      id: p.id,
      name: p.name,
      status: p.status as PortfolioProjectInput['status'],
      evm,
      progressPercent:
        totalTasks > 0 ? Math.round(progressSum / totalTasks) : 0,
      totalTasks,
      completedTasks,
      nextMilestone,
    }
  })

  return buildPortfolioReport(inputs, now)
}

/**
 * Lista compacta de proyectos accesibles para mostrar como links en
 * `/reports`. Los admins ven todo; los agentes solo los suyos.
 */
export async function listAvailableReports(): Promise<{
  projects: Array<{ id: string; name: string; status: string }>
  isAdmin: boolean
}> {
  const user = await requireUser()
  const isAdmin = hasAdminRole(user.roles)

  const projects = isAdmin
    ? await prisma.project.findMany({
        select: { id: true, name: true, status: true },
        orderBy: { name: 'asc' },
      })
    : await prisma.project.findMany({
        where: { assignments: { some: { userId: user.id } } },
        select: { id: true, name: true, status: true },
        orderBy: { name: 'asc' },
      })

  return { projects, isAdmin }
}
