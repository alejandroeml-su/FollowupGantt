/**
 * Wave P10 (HU-10.6 · GAMMA-3.1) — Loader de finanzas portfolio.
 *
 * Para cada proyecto agrega:
 *  - BAC: Project.budget convertido a USD (snapshot)
 *  - AC: sum(Expense.amountUsd) status APPROVED|REIMBURSED
 *  - EV: sum(Task.earnedValue) o BAC × avgProgress%
 *  - PV: sum(Task.plannedValue) (si está poblado)
 *
 * Y deriva CPI/SPI/EAC/ETC/VAC vía `evm.ts`.
 */

import prisma from '@/lib/prisma'
import { aggregatePortfolioEvm, computeEvmMetrics, type EvmMetrics } from './evm'

export interface PortfolioFinanceProject {
  projectId: string
  projectName: string
  managerName: string | null
  budgetCurrency: string | null
  metrics: EvmMetrics
  /** Avance promedio de tasks (0-100) usado como fallback EV. */
  progress: number
  /** True si EV se derivó de progress×BAC en lugar de Task.earnedValue. */
  evDerived: boolean
}

export interface PortfolioFinanceOverview {
  generatedAt: string
  projects: PortfolioFinanceProject[]
  totals: EvmMetrics
}

export interface PortfolioFinanceFilters {
  areaId?: string | null
  managerId?: string | null
  excludeClosed?: boolean
}

const APPROVED_OR_REIMBURSED = ['APPROVED', 'REIMBURSED'] as const

export async function loadPortfolioFinance(
  filters: PortfolioFinanceFilters = {},
): Promise<PortfolioFinanceOverview> {
  const excludeClosed = filters.excludeClosed ?? true
  const where: Record<string, unknown> = {}
  if (filters.areaId) where.areaId = filters.areaId
  if (filters.managerId) where.managerId = filters.managerId
  if (excludeClosed) where.status = { notIn: ['COMPLETED'] }

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      budget: true,
      budgetCurrency: true,
      manager: { select: { name: true } },
      tasks: {
        where: { archivedAt: null },
        select: {
          progress: true,
          earnedValue: true,
          plannedValue: true,
        },
      },
      expenses: {
        where: {
          status: { in: [...APPROVED_OR_REIMBURSED] },
        },
        select: { amountUsd: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  const items: PortfolioFinanceProject[] = projects.map((p) => {
    const bac = p.budget != null ? Number(p.budget) : null

    const ac = p.expenses.reduce((acc, e) => {
      return acc + (e.amountUsd != null ? Number(e.amountUsd) : 0)
    }, 0)

    const totalTasks = p.tasks.length
    const avgProgress =
      totalTasks === 0
        ? 0
        : p.tasks.reduce((acc, t) => acc + (t.progress ?? 0), 0) / totalTasks

    // EV: preferimos sum(Task.earnedValue); si todos null caemos a BAC × progress%
    const evFromTasks = p.tasks.reduce(
      (acc, t) => acc + (t.earnedValue ?? 0),
      0,
    )
    let ev: number | null = null
    let evDerived = false
    if (evFromTasks > 0) {
      ev = evFromTasks
    } else if (bac != null) {
      ev = (bac * avgProgress) / 100
      evDerived = true
    }

    // PV: sum(Task.plannedValue); si todos null queda null
    const pvFromTasks = p.tasks.reduce(
      (acc, t) => acc + (t.plannedValue ?? 0),
      0,
    )
    const pv = pvFromTasks > 0 ? pvFromTasks : null

    return {
      projectId: p.id,
      projectName: p.name,
      managerName: p.manager?.name ?? null,
      budgetCurrency: p.budgetCurrency,
      metrics: computeEvmMetrics({ bac, ev, ac: ac > 0 ? ac : null, pv }),
      progress: Math.round(avgProgress),
      evDerived,
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    projects: items,
    totals: aggregatePortfolioEvm(items.map((i) => i.metrics)),
  }
}
