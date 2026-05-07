/**
 * Wave P10 (HU-10.1) — Agregaciones de portfolio sobre Prisma.
 *
 * NOTA arquitectura: para Wave P10 simplificamos a queries TS directas (no
 * materialized view) porque el stock actual es <5 proyectos. Si crecemos a
 * >50 proyectos, refactorizar a una `MATERIALIZED VIEW portfolio_project_summary`
 * refrescada por cron es la siguiente iteración (ADR-P10-1 documentado en
 * `WAVE-P10-KICKOFF.md`).
 *
 * Tradeoff aceptado: N+1 ligero al cargar nextRelease/currentSprint per
 * proyecto. Cache TTL 5min en `cache.ts` mitiga el costo en uso normal.
 */

import prisma from '@/lib/prisma'
import { deriveHealthStatus } from './health'
import type {
  PortfolioFilters,
  PortfolioOverview,
  PortfolioProjectSummary,
} from './types'

const NOW = () => new Date()

export async function loadPortfolioOverview(
  filters: PortfolioFilters = {},
): Promise<PortfolioOverview> {
  const excludeClosed = filters.excludeClosed ?? true

  const where: Record<string, unknown> = {}
  if (filters.areaId) where.areaId = filters.areaId
  if (filters.managerId) where.managerId = filters.managerId
  if (excludeClosed) {
    where.status = { notIn: ['COMPLETED'] }
  }

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      status: true,
      cpi: true,
      spi: true,
      area: { select: { name: true } },
      manager: { select: { name: true } },
      tasks: {
        where: { archivedAt: null },
        select: {
          id: true,
          status: true,
          progress: true,
          updatedAt: true,
        },
      },
      risks: {
        where: { status: { notIn: ['CLOSED', 'ACCEPTED'] } },
        select: { probability: true, impact: true },
      },
      releases: {
        where: { releasedDate: null },
        orderBy: { plannedDate: 'asc' },
        take: 1,
        select: { id: true, name: true, plannedDate: true },
      },
      sprints: {
        where: {
          startDate: { lte: NOW() },
          endDate: { gte: NOW() },
        },
        orderBy: { startDate: 'desc' },
        take: 1,
        select: { id: true, name: true, endDate: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  const summaries: PortfolioProjectSummary[] = projects.map((p) => {
    const totalTasks = p.tasks.length
    const activeTasks = p.tasks.filter((t) => t.status !== 'DONE').length

    const progressAvg =
      totalTasks === 0
        ? 0
        : Math.round(
            p.tasks.reduce((acc, t) => acc + (t.progress ?? 0), 0) /
              totalTasks,
          )

    // Severity derivada del producto probability × impact (matriz PMBOK 5×5).
    // HIGH ≥ 12, MEDIUM 6-11, LOW 1-5.
    let high = 0
    let medium = 0
    let low = 0
    for (const r of p.risks) {
      const score = r.probability * r.impact
      if (score >= 12) high++
      else if (score >= 6) medium++
      else low++
    }

    const lastActivity = p.tasks.reduce<Date | null>((max, t) => {
      const u = t.updatedAt
      if (!max) return u
      return u.getTime() > max.getTime() ? u : max
    }, null)

    const nextRelease = p.releases[0]
      ? {
          id: p.releases[0].id,
          name: p.releases[0].name,
          targetDate: p.releases[0].plannedDate
            ? p.releases[0].plannedDate.toISOString()
            : null,
        }
      : null

    const currentSprint = p.sprints[0]
      ? {
          id: p.sprints[0].id,
          name: p.sprints[0].name,
          endDate: p.sprints[0].endDate
            ? p.sprints[0].endDate.toISOString()
            : null,
        }
      : null

    const health = deriveHealthStatus({
      cpi: p.cpi,
      spi: p.spi,
      highRiskCount: high,
    })

    return {
      id: p.id,
      name: p.name,
      status: p.status,
      health,
      progress: progressAvg,
      cpi: p.cpi,
      spi: p.spi,
      areaName: p.area?.name ?? null,
      managerName: p.manager?.name ?? null,
      activeTasks,
      totalTasks,
      nextRelease,
      currentSprint,
      riskCount: { high, medium, low },
      lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
    }
  })

  // Filtro post-aggregation por health (lo aplicamos aquí porque se calcula
  // a partir de varias señales y no se puede expresar en `where` Prisma).
  const filtered = filters.health
    ? summaries.filter((s) => s.health === filters.health)
    : summaries

  const totals = filtered.reduce(
    (acc, p) => {
      acc.activeTasks += p.activeTasks
      acc.totalTasks += p.totalTasks
      if (p.cpi != null) acc._cpiSum += p.cpi
      if (p.cpi != null) acc._cpiCount += 1
      if (p.spi != null) acc._spiSum += p.spi
      if (p.spi != null) acc._spiCount += 1
      switch (p.health) {
        case 'ON_TRACK':
          acc.onTrack += 1
          break
        case 'AT_RISK':
          acc.atRisk += 1
          break
        case 'DELAYED':
          acc.delayed += 1
          break
        case 'BLOCKED':
          acc.blocked += 1
          break
      }
      return acc
    },
    {
      projects: filtered.length,
      onTrack: 0,
      atRisk: 0,
      delayed: 0,
      blocked: 0,
      activeTasks: 0,
      totalTasks: 0,
      _cpiSum: 0,
      _cpiCount: 0,
      _spiSum: 0,
      _spiCount: 0,
    },
  )

  return {
    generatedAt: new Date().toISOString(),
    projects: filtered,
    totals: {
      projects: totals.projects,
      onTrack: totals.onTrack,
      atRisk: totals.atRisk,
      delayed: totals.delayed,
      blocked: totals.blocked,
      activeTasks: totals.activeTasks,
      totalTasks: totals.totalTasks,
      avgCpi:
        totals._cpiCount === 0
          ? null
          : Number((totals._cpiSum / totals._cpiCount).toFixed(2)),
      avgSpi:
        totals._spiCount === 0
          ? null
          : Number((totals._spiSum / totals._spiCount).toFixed(2)),
    },
  }
}
