import { describe, it, expect } from 'vitest'
import {
  predictDelayRisk,
  type RiskTaskInput,
  type RiskAssigneeHistory,
} from '@/lib/ai/predict-risk'

/**
 * Ola P5 · Equipo P5-4 — Tests de la heurística `predictDelayRisk`.
 *
 * Cubre los 3 niveles (low/medium/high), todos los factores y el
 * determinismo (now inyectado).
 */

const NOW = new Date('2026-05-03T12:00:00Z')

function task(partial: Partial<RiskTaskInput>): RiskTaskInput {
  return {
    id: partial.id ?? 't1',
    status: partial.status ?? 'IN_PROGRESS',
    progress: partial.progress ?? 0,
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
    estimatedHours: partial.estimatedHours,
    assigneeId: partial.assigneeId ?? null,
    predecessors: partial.predecessors ?? [],
  }
}

describe('predictDelayRisk · level low', () => {
  it('tarea sin fechas y sin factores → low', () => {
    const r = predictDelayRisk(task({}), null, NOW)
    expect(r.level).toBe('low')
    expect(r.score).toBe(0)
    expect(r.factors).toEqual(['Sin señales de riesgo detectadas'])
  })

  it('tarea progresando bien (50% progress, 30% elapsed) → low', () => {
    const r = predictDelayRisk(
      task({
        startDate: new Date('2026-04-23T00:00:00Z'),
        endDate: new Date('2026-05-23T00:00:00Z'),
        progress: 50,
      }),
      null,
      NOW,
    )
    expect(r.level).toBe('low')
    expect(r.score).toBe(0)
  })

  it('historial limpio del assignee no aporta riesgo', () => {
    const history: RiskAssigneeHistory = { totalCompleted: 10, totalLate: 1 }
    const r = predictDelayRisk(task({ assigneeId: 'u1' }), history, NOW)
    expect(r.level).toBe('low')
  })
})

describe('predictDelayRisk · level medium', () => {
  it('progreso bajo (medium): elapsed 67%, progress 0 → score 0.5', () => {
    // 30 días totales (04-13 → 05-13), 20 días elapsed (now=05-03) → ratio
    // 0.667; expected progress = 0.667*100*0.8 ≈ 53.3; delta 53.3 → contrib
    // min(0.5, 53.3/100 * 0.5 * 2) = 0.5 → level medium.
    const r = predictDelayRisk(
      task({
        startDate: new Date('2026-04-13T00:00:00Z'),
        endDate: new Date('2026-05-13T00:00:00Z'),
        progress: 0,
      }),
      null,
      NOW,
    )
    expect(r.score).toBe(0.5)
    expect(r.level).toBe('medium')
  })

  it('combinación assignee tarde + tarea grande → medium', () => {
    const history: RiskAssigneeHistory = { totalCompleted: 10, totalLate: 5 }
    const r = predictDelayRisk(
      task({ assigneeId: 'u1', estimatedHours: 80 }),
      history,
      NOW,
    )
    expect(r.score).toBe(0.35)
    expect(r.level).toBe('medium')
    expect(r.factors.some((f) => /Asignado entrega tarde/.test(f))).toBe(true)
    expect(r.factors.some((f) => /Tarea grande/.test(f))).toBe(true)
  })
})

describe('predictDelayRisk · level high', () => {
  it('vencida y no DONE → high', () => {
    const r = predictDelayRisk(
      task({
        status: 'IN_PROGRESS',
        startDate: new Date('2026-03-01T00:00:00Z'),
        endDate: new Date('2026-04-01T00:00:00Z'),
        progress: 50,
      }),
      null,
      NOW,
    )
    expect(r.level).toBe('high')
    expect(r.factors.some((f) => /vencida/.test(f))).toBe(true)
  })

  it('combinación de todos los factores → high', () => {
    const history: RiskAssigneeHistory = { totalCompleted: 10, totalLate: 6 }
    const r = predictDelayRisk(
      task({
        startDate: new Date('2026-04-13T00:00:00Z'),
        endDate: new Date('2026-05-13T00:00:00Z'),
        progress: 5,
        assigneeId: 'u1',
        estimatedHours: 60,
        predecessors: [
          { id: 'p1', status: 'TODO' },
          { id: 'p2', status: 'IN_PROGRESS' },
          { id: 'p3', status: 'TODO' },
        ],
      }),
      history,
      NOW,
    )
    expect(r.score).toBeGreaterThan(0.67)
    expect(r.level).toBe('high')
  })
})

describe('predictDelayRisk · factores aislados', () => {
  it('historicalLateness solo cuenta si totalCompleted >= 5', () => {
    const sparse: RiskAssigneeHistory = { totalCompleted: 2, totalLate: 2 }
    const r = predictDelayRisk(task({ assigneeId: 'u1' }), sparse, NOW)
    expect(r.factors.some((f) => /entrega tarde/.test(f))).toBe(false)
  })

  it('predecesoras pendientes capean a 0.4', () => {
    const r = predictDelayRisk(
      task({
        predecessors: Array.from({ length: 10 }, (_, i) => ({
          id: `p${i}`,
          status: 'TODO' as const,
        })),
      }),
      null,
      NOW,
    )
    expect(r.score).toBeLessThanOrEqual(0.4)
    expect(r.factors.some((f) => /predecesora\(s\) pendientes/.test(f))).toBe(true)
  })

  it('predecesoras DONE no aportan riesgo', () => {
    const r = predictDelayRisk(
      task({
        predecessors: [
          { id: 'p1', status: 'DONE' },
          { id: 'p2', status: 'DONE' },
        ],
      }),
      null,
      NOW,
    )
    expect(r.score).toBe(0)
  })

  it('estimatedHours = 40 NO suma (umbral exclusivo)', () => {
    const r = predictDelayRisk(task({ estimatedHours: 40 }), null, NOW)
    expect(r.score).toBe(0)
  })

  it('estimatedHours = 41 SÍ suma 0.15', () => {
    const r = predictDelayRisk(task({ estimatedHours: 41 }), null, NOW)
    expect(r.score).toBe(0.15)
  })

  it('tarea DONE no contribuye con progreso bajo', () => {
    const r = predictDelayRisk(
      task({
        status: 'DONE',
        startDate: new Date('2026-03-01T00:00:00Z'),
        endDate: new Date('2026-04-01T00:00:00Z'),
        progress: 100,
      }),
      null,
      NOW,
    )
    expect(r.level).toBe('low')
  })
})

describe('predictDelayRisk · determinismo', () => {
  it('misma entrada → misma salida', () => {
    const input = task({
      startDate: new Date('2026-04-13T00:00:00Z'),
      endDate: new Date('2026-05-13T00:00:00Z'),
      progress: 10,
      estimatedHours: 50,
    })
    const a = predictDelayRisk(input, null, NOW)
    const b = predictDelayRisk(input, null, NOW)
    expect(a).toEqual(b)
  })

  it('score nunca excede 1.0 ni baja de 0', () => {
    const r = predictDelayRisk(
      task({
        status: 'TODO',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-02-01T00:00:00Z'),
        progress: 0,
        estimatedHours: 100,
        predecessors: Array.from({ length: 20 }, (_, i) => ({
          id: `p${i}`,
          status: 'TODO' as const,
        })),
      }),
      { totalCompleted: 100, totalLate: 80 },
      NOW,
    )
    expect(r.score).toBeLessThanOrEqual(1)
    expect(r.score).toBeGreaterThanOrEqual(0)
  })
})
