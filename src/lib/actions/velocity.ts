'use server'

/**
 * Wave P10 (HU-10.3 · GAMMA-1.1) — Server actions para velocity histórica.
 *
 * Lee sprints cerrados del proyecto y deriva la velocity real (suma de SP
 * de tasks completadas en ese sprint). Si el sprint guardó `velocityActual`
 * lo respeta; si no, calcula on-the-fly.
 *
 * Combina con `lib/forecasting/monte-carlo` para entregar forecast P10/P50/P90.
 */

import prisma from '@/lib/prisma'
import {
  forecastCumulativeVelocity,
  forecastNextSprintVelocity,
  type VelocityForecast,
  type MultiSprintForecast,
  type VelocityHistoryEntry,
} from '@/lib/forecasting/monte-carlo'

export interface VelocitySnapshot {
  projectId: string
  history: VelocityHistoryEntry[]
  nextSprintForecast: VelocityForecast | null
  /** Forecast del siguiente release: si null, no hay datos suficientes. */
  cumulativeForecast: MultiSprintForecast | null
}

/**
 * Devuelve los últimos N sprints cerrados del proyecto con su velocity real
 * + forecast del siguiente sprint. `lookback` default 6 (PMI sugiere ≥3 para
 * Monte Carlo y 6 da estabilidad razonable).
 */
export async function computeVelocitySnapshot(input: {
  projectId: string
  lookback?: number
  cumulativeHorizon?: number
}): Promise<VelocitySnapshot> {
  if (!input.projectId) {
    throw new Error('[INVALID_INPUT] projectId requerido')
  }
  const lookback = input.lookback ?? 6
  const cumulativeHorizon = input.cumulativeHorizon ?? 3

  const now = new Date()
  const sprints = await prisma.sprint.findMany({
    where: {
      projectId: input.projectId,
      endDate: { lt: now },
    },
    orderBy: { endDate: 'desc' },
    take: lookback,
    select: {
      id: true,
      name: true,
      endDate: true,
      velocityActual: true,
      tasks: {
        where: {
          archivedAt: null,
          status: 'DONE',
          storyPoints: { not: null },
        },
        select: { storyPoints: true },
      },
    },
  })

  // Devolvemos en orden cronológico ascendente para que charts sean naturales.
  const ordered = [...sprints].reverse()

  const history: VelocityHistoryEntry[] = ordered.map((s) => {
    const computed = s.tasks.reduce(
      (acc, t) => acc + (t.storyPoints ?? 0),
      0,
    )
    const sp = s.velocityActual ?? computed
    return {
      sprintId: s.id,
      sprintName: s.name,
      completedSp: sp,
      endDate: s.endDate.toISOString(),
    }
  })

  return {
    projectId: input.projectId,
    history,
    nextSprintForecast: forecastNextSprintVelocity(history),
    cumulativeForecast: forecastCumulativeVelocity(history, cumulativeHorizon),
  }
}
