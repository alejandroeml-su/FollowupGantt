/**
 * Wave P10 (HU-10.1) — Tipos compartidos de portfolio.
 *
 * Módulo puro reutilizado por:
 *  - `aggregations.ts` (queries Prisma)
 *  - `health.ts` (cálculo de status)
 *  - `cache.ts` (TTL cache)
 *  - server action `getPortfolioOverview`
 *  - componentes UI `/portfolio`
 */

export type ProjectHealthStatus =
  | 'ON_TRACK'
  | 'AT_RISK'
  | 'DELAYED'
  | 'BLOCKED'

export type ProjectPhasePmi =
  | 'INITIATION'
  | 'PLANNING'
  | 'EXECUTION'
  | 'CLOSING'

export interface PortfolioProjectSummary {
  id: string
  name: string
  status: string // ProjectStatus enum del schema (PLANNING/ACTIVE/...)
  health: ProjectHealthStatus
  progress: number // 0-100
  cpi: number | null // null si no hay datos EVM
  spi: number | null
  areaName: string | null
  managerName: string | null
  activeTasks: number
  totalTasks: number
  nextRelease: {
    id: string
    name: string
    targetDate: string | null // ISO
  } | null
  currentSprint: {
    id: string
    name: string
    endDate: string | null
  } | null
  riskCount: {
    high: number
    medium: number
    low: number
  }
  /** Última actualización del rollup (created/updated más reciente). */
  lastActivityAt: string | null
}

export interface PortfolioOverview {
  generatedAt: string
  projects: PortfolioProjectSummary[]
  /** Resumen global. */
  totals: {
    projects: number
    onTrack: number
    atRisk: number
    delayed: number
    blocked: number
    activeTasks: number
    totalTasks: number
    avgCpi: number | null
    avgSpi: number | null
  }
}

export interface PortfolioFilters {
  areaId?: string | null
  managerId?: string | null
  health?: ProjectHealthStatus | null
  /** Si true, oculta proyectos en CLOSED/ARCHIVED. Default true. */
  excludeClosed?: boolean
}
