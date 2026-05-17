import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * US-9.2 · Wave R5 — Tests del catálogo de auto-metrics.
 *
 * Mockea `@/lib/prisma` para que las funciones puras de cómputo se
 * puedan ejercer sin BD real. Verificamos:
 *   - Catálogo expone las 6 claves esperadas.
 *   - `dod_completion_rate` cuenta sólo AGILE_STORY con DoD checklist
 *     completo y devuelve 0 cuando hay tareas sin DoD.
 *   - `pmi_raci_coverage` cuenta % de PMI_TASK con accountable.
 *   - `velocity_avg_3sprints` devuelve null cuando no hay sprints.
 *   - `risk_register_coverage` normaliza a "risks por 10 tareas".
 */

const taskFindMany = vi.fn()
const taskCount = vi.fn()
const riskCount = vi.fn()
const sprintFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    task: {
      findMany: (...a: unknown[]) => taskFindMany(...a),
      count: (...a: unknown[]) => taskCount(...a),
    },
    risk: {
      count: (...a: unknown[]) => riskCount(...a),
    },
    sprint: {
      findMany: (...a: unknown[]) => sprintFindMany(...a),
    },
  },
}))

beforeEach(() => {
  taskFindMany.mockReset()
  taskCount.mockReset()
  riskCount.mockReset()
  sprintFindMany.mockReset()
})

describe('AUTO_METRICS catalog', () => {
  it('expone las 6 claves esperadas y mantiene defaults razonables', async () => {
    const { AUTO_METRICS, AUTO_METRIC_KEYS } = await import(
      '@/lib/gap-analysis/auto-metrics'
    )
    expect(AUTO_METRIC_KEYS).toEqual([
      'dod_completion_rate',
      'pmi_raci_coverage',
      'velocity_avg_3sprints',
      'definition_complete_rate',
      'risk_register_coverage',
      'cycle_time_p50',
    ])
    // cycle_time_p50 es la única "menos es mejor".
    const cycle = AUTO_METRICS.find((m) => m.key === 'cycle_time_p50')!
    expect(cycle.direction).toBe('lower-is-better')
    const dod = AUTO_METRICS.find((m) => m.key === 'dod_completion_rate')!
    expect(dod.direction).toBe('higher-is-better')
  })

  it('findAutoMetric devuelve undefined para una clave inválida', async () => {
    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    expect(findAutoMetric('non_existent_metric')).toBeUndefined()
    expect(findAutoMetric('dod_completion_rate')).toBeDefined()
  })
})

describe('computeDodCompletionRate', () => {
  it('cuenta % de tasks AGILE con DoD 100% checked', async () => {
    taskFindMany.mockResolvedValue([
      {
        id: 't1',
        scrumAttributes: {
          dodChecklist: [{ item: 'A', checked: true }],
        },
      },
      {
        id: 't2',
        scrumAttributes: {
          dodChecklist: [
            { item: 'A', checked: true },
            { item: 'B', checked: false },
          ],
        },
      },
      // Task sin checklist: cuenta como incompleta (denominador, no
      // numerador) — política documentada en auto-metrics.ts.
      { id: 't3', scrumAttributes: null },
    ])

    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    const dod = findAutoMetric('dod_completion_rate')!
    const result = await dod.compute('proj-1')

    // 1 de 3 tareas completas → 33.33%
    expect(result.value).toBe(33.33)
    expect(result.unit).toBe('%')
    expect(result.sampleSize).toBe(2) // sólo t1 y t2 tienen checklist
    expect(result.totalCandidates).toBe(3)
  })

  it('devuelve null cuando no hay tareas AGILE', async () => {
    taskFindMany.mockResolvedValue([])
    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    const dod = findAutoMetric('dod_completion_rate')!
    const result = await dod.compute('proj-1')
    expect(result.value).toBeNull()
    expect(result.totalCandidates).toBe(0)
  })
})

describe('computePmiRaciCoverage', () => {
  it('cuenta % de tasks PMI con un accountable definido', async () => {
    taskFindMany.mockResolvedValue([
      {
        id: 't1',
        pmiAttributes: { raci: { accountable: 'u1' } },
      },
      {
        id: 't2',
        pmiAttributes: { raci: { responsible: ['u2'] } },
      },
      { id: 't3', pmiAttributes: null },
    ])

    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    const raci = findAutoMetric('pmi_raci_coverage')!
    const result = await raci.compute('proj-1')

    // 1 de 3 → 33.33%
    expect(result.value).toBe(33.33)
    expect(result.unit).toBe('%')
    expect(result.sampleSize).toBe(1)
  })
})

describe('computeVelocityAvg3Sprints', () => {
  it('devuelve null cuando no hay sprints cerrados', async () => {
    sprintFindMany.mockResolvedValue([])
    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    const v = findAutoMetric('velocity_avg_3sprints')!
    const result = await v.compute('proj-1')
    expect(result.value).toBeNull()
    expect(result.unit).toBe('pts')
  })

  it('promedia los últimos 3 sprints con velocityActual no null', async () => {
    sprintFindMany.mockResolvedValue([
      { id: 's1', velocityActual: 20 },
      { id: 's2', velocityActual: 30 },
      { id: 's3', velocityActual: 40 },
    ])
    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    const v = findAutoMetric('velocity_avg_3sprints')!
    const result = await v.compute('proj-1')
    expect(result.value).toBe(30)
    expect(result.sampleSize).toBe(3)
  })
})

describe('computeRiskRegisterCoverage', () => {
  it('normaliza a risks por cada 10 tasks', async () => {
    taskCount.mockResolvedValue(20)
    riskCount.mockResolvedValue(4)
    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    const r = findAutoMetric('risk_register_coverage')!
    const result = await r.compute('proj-1')
    // 4 risks / 20 tasks * 10 = 2 risks/10 tasks
    expect(result.value).toBe(2)
    expect(result.unit).toBe('risks/10 tasks')
  })

  it('devuelve null cuando el proyecto no tiene tareas', async () => {
    taskCount.mockResolvedValue(0)
    riskCount.mockResolvedValue(0)
    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    const r = findAutoMetric('risk_register_coverage')!
    const result = await r.compute('proj-1')
    expect(result.value).toBeNull()
  })
})

describe('computeDefinitionCompleteRate', () => {
  it('cuenta % de tasks con definitionComplete=true', async () => {
    taskCount
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(7) // complete
    const { findAutoMetric } = await import('@/lib/gap-analysis/auto-metrics')
    const d = findAutoMetric('definition_complete_rate')!
    const result = await d.compute('proj-1')
    expect(result.value).toBe(70)
    expect(result.unit).toBe('%')
  })
})
