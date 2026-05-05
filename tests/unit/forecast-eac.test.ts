import { describe, it, expect } from 'vitest'

/**
 * Ola P8 · Equipo P8-3 — tests de `forecast-eac`.
 *
 * Cubre:
 *   - cálculo BAC/EV/AC/CPI/EAC clásico PMI.
 *   - factor velocity (capping 0.7-1.3).
 *   - bordes: AC=0, EV=0, sin sprints, sprints sin endedAt, bacOverride.
 */

import {
  forecastEac,
  computeVelocityFactor,
  type SprintVelocityPoint,
  type TaskForEac,
} from '@/lib/cost/forecast-eac'

const baseTasks: TaskForEac[] = [
  { id: 't1', plannedValue: 1000, progress: 100 }, // EV=1000
  { id: 't2', plannedValue: 1000, progress: 50 }, // EV=500
  { id: 't3', plannedValue: 1000, progress: 0 }, // EV=0
]
// BAC=3000, EV=1500

function makeSprint(
  i: number,
  velocityActual: number | null,
  capacity: number | null = 30,
  ended = true,
): SprintVelocityPoint {
  return {
    sprintId: `s${i}`,
    velocityActual,
    capacity,
    endedAt: ended ? new Date(2026, 3, i + 1) : null,
  }
}

describe('forecastEac', () => {
  it('calcula BAC, EV y AC correctamente', () => {
    const r = forecastEac({ tasks: baseTasks, actualCostUsd: 1000, sprints: [] })
    expect(r.bac).toBe(3000)
    expect(r.ev).toBe(1500)
    expect(r.ac).toBe(1000)
  })

  it('CPI = EV/AC y EAC = BAC/CPI cuando AC > 0', () => {
    const r = forecastEac({ tasks: baseTasks, actualCostUsd: 1000, sprints: [] })
    expect(r.cpi).toBeCloseTo(1.5, 4)
    expect(r.eacBase).toBeCloseTo(2000, 2) // 3000 / 1.5
  })

  it('CPI = Infinity cuando AC=0 y EAC ≈ BAC', () => {
    const r = forecastEac({ tasks: baseTasks, actualCostUsd: 0, sprints: [] })
    expect(r.cpi).toBe(Number.POSITIVE_INFINITY)
    expect(r.eacBase).toBe(3000)
  })

  it('CPI=0 con EV=0/AC>0 usa fallback conservador (AC + (BAC-EV))', () => {
    const tasks: TaskForEac[] = [
      { id: 't1', plannedValue: 1000, progress: 0 },
      { id: 't2', plannedValue: 2000, progress: 0 },
    ]
    const r = forecastEac({ tasks, actualCostUsd: 500, sprints: [] })
    expect(r.cpi).toBe(0)
    // EAC = AC + (BAC - EV) = 500 + (3000 - 0) = 3500
    expect(r.eacBase).toBe(3500)
  })

  it('VAC = BAC - EAC (positivo bajo presupuesto)', () => {
    const r = forecastEac({ tasks: baseTasks, actualCostUsd: 1000, sprints: [] })
    expect(r.vac).toBeCloseTo(1000, 2) // 3000 - 2000
  })

  it('ETC nunca negativo', () => {
    // CPI < 1 inflates EAC; EAC > AC siempre.
    const r = forecastEac({ tasks: baseTasks, actualCostUsd: 5000, sprints: [] })
    expect(r.etc).toBeGreaterThanOrEqual(0)
  })

  it('sin sprints completados → velocityFactor = 1', () => {
    const r = forecastEac({ tasks: baseTasks, actualCostUsd: 1000, sprints: [] })
    expect(r.velocityFactor).toBe(1)
    expect(r.eac).toBe(r.eacBase)
  })

  it('velocity baja (<target) infla EAC vía penalty', () => {
    const sprints = [
      makeSprint(1, 30), // histórico
      makeSprint(2, 30), // histórico
      makeSprint(3, 30), // histórico
      makeSprint(4, 15), // recientes (< target)
      makeSprint(5, 15),
      makeSprint(6, 15),
    ]
    const r = forecastEac({
      tasks: baseTasks,
      actualCostUsd: 1000,
      sprints,
      velocityWindow: 3,
      targetVelocity: 30,
    })
    // factor = 15/30 = 0.5 → capped 0.7
    expect(r.velocityFactor).toBe(0.7)
    // penalty = 1 + (1 - 0.7) = 1.3 → eac = eacBase * 1.3
    expect(r.eac).toBeCloseTo(r.eacBase * 1.3, 1)
  })

  it('velocity alta (>target) NO premia (sesgo conservador)', () => {
    const sprints = [makeSprint(1, 60), makeSprint(2, 60), makeSprint(3, 60)]
    const r = forecastEac({
      tasks: baseTasks,
      actualCostUsd: 1000,
      sprints,
      targetVelocity: 30,
    })
    // factor = 60/30 = 2 → capped 1.3, pero penalty=1 cuando factor>=1
    expect(r.velocityFactor).toBe(1.3)
    expect(r.eac).toBeCloseTo(r.eacBase, 2)
  })

  it('ignora sprints sin endedAt', () => {
    const sprints = [
      makeSprint(1, 30, 30, true),
      makeSprint(2, 10, 30, false),
    ]
    const factor = computeVelocityFactor(sprints, 3, 30)
    expect(factor).toBe(1) // sólo 1 sprint completado, vs target 30 → 1
  })

  it('ignora sprints con velocityActual null', () => {
    const sprints = [makeSprint(1, null), makeSprint(2, 30)]
    const factor = computeVelocityFactor(sprints, 3, 30)
    // Sólo 1 con datos → 30/30 = 1
    expect(factor).toBe(1)
  })

  it('bacOverride sobrescribe sum(plannedValue)', () => {
    const r = forecastEac({
      tasks: baseTasks,
      actualCostUsd: 1000,
      sprints: [],
      bacOverride: 5000,
    })
    expect(r.bac).toBe(5000)
  })

  it('progress > 100 se acota a 100 al calcular EV', () => {
    const tasks: TaskForEac[] = [{ id: 't1', plannedValue: 1000, progress: 150 }]
    const r = forecastEac({ tasks, actualCostUsd: 0, sprints: [] })
    expect(r.ev).toBe(1000)
  })

  it('progress < 0 se acota a 0 al calcular EV', () => {
    const tasks: TaskForEac[] = [{ id: 't1', plannedValue: 1000, progress: -50 }]
    const r = forecastEac({ tasks, actualCostUsd: 0, sprints: [] })
    expect(r.ev).toBe(0)
  })

  it('plannedValue null se trata como 0', () => {
    const tasks: TaskForEac[] = [
      { id: 't1', plannedValue: null, progress: 50 },
      { id: 't2', plannedValue: 100, progress: 100 },
    ]
    const r = forecastEac({ tasks, actualCostUsd: 50, sprints: [] })
    expect(r.bac).toBe(100)
    expect(r.ev).toBe(100)
  })

  it('targetVelocity null + histórico previo → usa promedio histórico', () => {
    // 6 sprints; ventana = 3 → recientes 4-6, históricos 1-3.
    const sprints = [
      makeSprint(1, 40),
      makeSprint(2, 40),
      makeSprint(3, 40), // hist promedio = 40
      makeSprint(4, 20),
      makeSprint(5, 20),
      makeSprint(6, 20), // recientes promedio = 20
    ]
    const factor = computeVelocityFactor(sprints, 3, null)
    // 20/40 = 0.5 → capped 0.7
    expect(factor).toBe(0.7)
  })
})
