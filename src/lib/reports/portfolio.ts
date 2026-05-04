/**
 * Ola P5 · Equipo P5-3 · Reportes ejecutivos
 *
 * Portfolio dashboard: agrega métricas cross-project para el resumen
 * ejecutivo. Los cálculos por proyecto se delegan a `evm.ts`; aquí solo
 * armamos las filas y el resumen global (cuántos en rojo / amarillo /
 * verde, próximo hito por proyecto, etc.).
 */

import { classifyHealth, type EVMResult, type HealthStatus } from './evm'

export type PortfolioProjectInput = {
  id: string
  name: string
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED'
  evm: EVMResult | null // null si insuficiente data o sin presupuesto
  progressPercent: number
  totalTasks: number
  completedTasks: number
  nextMilestone: {
    id: string
    title: string
    endDate: string // ISO
    daysUntil: number
  } | null
}

export type PortfolioRow = PortfolioProjectInput & {
  health: HealthStatus
  cv: number | null
  spi: number | null
  cpi: number | null
}

export type PortfolioReport = {
  generatedAt: string
  rows: PortfolioRow[]
  summary: {
    totalProjects: number
    healthBreakdown: Record<HealthStatus, number>
    activeProjects: number
    completedProjects: number
    avgProgress: number // 0..100
    avgSPI: number | null
    avgCPI: number | null
  }
}

export function buildPortfolioReport(
  projects: PortfolioProjectInput[],
  now: Date = new Date(),
): PortfolioReport {
  const rows: PortfolioRow[] = projects.map((p) => {
    if (!p.evm) {
      return {
        ...p,
        health: 'gray',
        cv: null,
        spi: null,
        cpi: null,
      }
    }
    return {
      ...p,
      health: classifyHealth({ cv: p.evm.cv, spi: p.evm.spi, cpi: p.evm.cpi }),
      cv: p.evm.cv,
      spi: p.evm.spi,
      cpi: p.evm.cpi,
    }
  })

  const healthBreakdown: Record<HealthStatus, number> = {
    green: 0,
    yellow: 0,
    red: 0,
    gray: 0,
  }
  let progressSum = 0
  let active = 0
  let completed = 0
  let spiSum = 0
  let spiCount = 0
  let cpiSum = 0
  let cpiCount = 0

  for (const r of rows) {
    healthBreakdown[r.health] += 1
    progressSum += r.progressPercent
    if (r.status === 'ACTIVE') active += 1
    if (r.status === 'COMPLETED') completed += 1
    if (r.spi != null) {
      spiSum += r.spi
      spiCount += 1
    }
    if (r.cpi != null) {
      cpiSum += r.cpi
      cpiCount += 1
    }
  }

  const totalProjects = rows.length
  const avgProgress =
    totalProjects > 0 ? Math.round(progressSum / totalProjects) : 0

  return {
    generatedAt: now.toISOString(),
    rows,
    summary: {
      totalProjects,
      healthBreakdown,
      activeProjects: active,
      completedProjects: completed,
      avgProgress,
      avgSPI: spiCount > 0 ? round4(spiSum / spiCount) : null,
      avgCPI: cpiCount > 0 ? round4(cpiSum / cpiCount) : null,
    },
  }
}

export function healthLabel(h: HealthStatus): string {
  switch (h) {
    case 'green':
      return 'Saludable'
    case 'yellow':
      return 'En margen'
    case 'red':
      return 'Crítico'
    case 'gray':
      return 'Sin datos'
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
