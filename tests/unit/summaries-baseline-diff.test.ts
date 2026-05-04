import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  computeBaselineDiff,
  generateBaselineDiffSummary,
  generateBaselineDiffSummaryHeuristic,
  type BaselineDiffInput,
} from '@/lib/ai/summaries/baseline-diff-summary'
import { injectLLMForTests } from '@/lib/ai/summaries/prompts'
import type { BaselineTask } from '@/lib/scheduling/baseline-snapshot'

/**
 * Ola P7 · Equipo P7-3 · Tests de baseline-diff summary.
 */

const NOW = new Date('2026-05-04T10:00:00Z')

function baseTask(over: Partial<BaselineTask>): BaselineTask {
  return {
    id: 'x',
    mnemonic: null,
    title: 'Tarea',
    plannedStart: '2026-04-01T00:00:00.000Z',
    plannedEnd: '2026-04-15T00:00:00.000Z',
    plannedValue: 100,
    earnedValue: 0,
    actualCost: 0,
    progress: 0,
    status: 'TODO',
    ...over,
  }
}

afterEach(() => {
  injectLLMForTests(null)
})

describe('baseline-diff · computeBaselineDiff', () => {
  it('detecta tareas atrasadas (plannedEnd movido a futuro)', () => {
    const input: BaselineDiffInput = {
      projectName: 'P',
      baseline: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        label: null,
        version: 1,
        tasks: [baseTask({ id: 'a', plannedEnd: '2026-04-15T00:00:00.000Z' })],
      },
      current: {
        asOf: NOW.toISOString(),
        tasks: [
          {
            id: 'a',
            title: 'Tarea',
            plannedEnd: '2026-04-20T00:00:00.000Z',
            plannedValue: 100,
            actualCost: 0,
            progress: 0,
            status: 'TODO',
          },
        ],
      },
    }
    const m = computeBaselineDiff(input)
    expect(m.delayed).toHaveLength(1)
    expect(m.delayed[0].daysShifted).toBe(5)
  })

  it('detecta cambios significativos de progreso (>=5%)', () => {
    const input: BaselineDiffInput = {
      projectName: 'P',
      baseline: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        label: null,
        version: 1,
        tasks: [baseTask({ id: 'a', progress: 10 }), baseTask({ id: 'b', progress: 50 })],
      },
      current: {
        asOf: NOW.toISOString(),
        tasks: [
          {
            id: 'a',
            title: 'A',
            plannedEnd: '2026-04-15T00:00:00.000Z',
            plannedValue: 100,
            actualCost: 0,
            progress: 12, // 2pp delta → no significativo
            status: 'IN_PROGRESS',
          },
          {
            id: 'b',
            title: 'B',
            plannedEnd: '2026-04-15T00:00:00.000Z',
            plannedValue: 100,
            actualCost: 0,
            progress: 80, // 30pp delta → sí
            status: 'IN_PROGRESS',
          },
        ],
      },
    }
    const m = computeBaselineDiff(input)
    expect(m.progressDelta.map((p) => p.id)).toEqual(['b'])
    expect(m.progressDelta[0].deltaPercent).toBe(30)
  })

  it('detecta tareas añadidas y removidas', () => {
    const input: BaselineDiffInput = {
      projectName: 'P',
      baseline: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        label: null,
        version: 1,
        tasks: [baseTask({ id: 'a', title: 'A' }), baseTask({ id: 'b', title: 'B' })],
      },
      current: {
        asOf: NOW.toISOString(),
        tasks: [
          {
            id: 'a',
            title: 'A',
            plannedEnd: '2026-04-15T00:00:00.000Z',
            plannedValue: 100,
            actualCost: 0,
            progress: 0,
            status: 'TODO',
          },
          {
            id: 'c',
            title: 'C nueva',
            plannedEnd: '2026-04-30T00:00:00.000Z',
            plannedValue: 50,
            actualCost: 0,
            progress: 0,
            status: 'TODO',
          },
        ],
      },
    }
    const m = computeBaselineDiff(input)
    expect(m.added.map((t) => t.id)).toEqual(['c'])
    expect(m.removed.map((t) => t.id)).toEqual(['b'])
  })

  it('calcula budgetVariancePercent correctamente', () => {
    const input: BaselineDiffInput = {
      projectName: 'P',
      baseline: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        label: null,
        version: 1,
        tasks: [
          baseTask({ id: 'a', actualCost: 1000 }),
          baseTask({ id: 'b', actualCost: 1000 }),
        ],
      },
      current: {
        asOf: NOW.toISOString(),
        tasks: [
          {
            id: 'a',
            title: 'A',
            plannedEnd: '2026-04-15T00:00:00.000Z',
            plannedValue: 100,
            actualCost: 1100,
            progress: 0,
            status: 'TODO',
          },
          {
            id: 'b',
            title: 'B',
            plannedEnd: '2026-04-15T00:00:00.000Z',
            plannedValue: 100,
            actualCost: 1100,
            progress: 0,
            status: 'TODO',
          },
        ],
      },
    }
    const m = computeBaselineDiff(input)
    // 2200 vs 2000 = +10%
    expect(m.budgetVariancePercent).toBe(10)
  })

  it('budgetVariancePercent es null si baseline AC = 0', () => {
    const input: BaselineDiffInput = {
      projectName: 'P',
      baseline: {
        capturedAt: '2026-04-01T00:00:00.000Z',
        label: null,
        version: 1,
        tasks: [baseTask({ id: 'a', actualCost: 0 })],
      },
      current: {
        asOf: NOW.toISOString(),
        tasks: [
          {
            id: 'a',
            title: 'A',
            plannedEnd: '2026-04-15T00:00:00.000Z',
            plannedValue: 100,
            actualCost: 500,
            progress: 0,
            status: 'TODO',
          },
        ],
      },
    }
    const m = computeBaselineDiff(input)
    expect(m.budgetVariancePercent).toBeNull()
  })
})

describe('baseline-diff · heurística', () => {
  it('genera markdown estructurado con cambios detectados', () => {
    const input: BaselineDiffInput = {
      projectName: 'Proyecto Alfa',
      baseline: {
        capturedAt: '2026-04-15T00:00:00.000Z',
        label: 'v.1 cierre Q1',
        version: 1,
        tasks: [baseTask({ id: 'a', actualCost: 500 })],
      },
      current: {
        asOf: NOW.toISOString(),
        tasks: [
          {
            id: 'a',
            title: 'Tarea A',
            plannedEnd: '2026-04-25T00:00:00.000Z', // +10 días
            plannedValue: 100,
            actualCost: 600, // +20%
            progress: 50, // baseline 0
            status: 'IN_PROGRESS',
          },
        ],
      },
    }
    const m = computeBaselineDiff(input)
    const out = generateBaselineDiffSummaryHeuristic(input, m, NOW)
    expect(out.source).toBe('heuristic')
    expect(out.headline).toContain('Proyecto Alfa')
    expect(out.headline).toContain('v.1 cierre Q1')
    expect(out.markdown).toContain('## Resumen')
    expect(out.markdown).toContain('## Atrasos vs baseline')
    expect(out.markdown).toContain('## Costos vs baseline')
    expect(out.markdown).toContain('Tarea A')
    expect(out.markdown).toContain('10 día(s)')
  })

  it('reporta cuando no hay cambios significativos', () => {
    const input: BaselineDiffInput = {
      projectName: 'P',
      baseline: {
        capturedAt: '2026-04-15T00:00:00.000Z',
        label: null,
        version: 1,
        tasks: [baseTask({ id: 'a' })],
      },
      current: {
        asOf: NOW.toISOString(),
        tasks: [
          {
            id: 'a',
            title: 'Tarea',
            plannedEnd: '2026-04-15T00:00:00.000Z',
            plannedValue: 100,
            actualCost: 0,
            progress: 0,
            status: 'TODO',
          },
        ],
      },
    }
    const m = computeBaselineDiff(input)
    const out = generateBaselineDiffSummaryHeuristic(input, m, NOW)
    expect(out.headline).toContain('sin cambios')
    expect(out.markdown).toContain('Ninguna tarea movida')
  })
})

describe('baseline-diff · LLM mock', () => {
  it('usa el LLM cuando responde válido', async () => {
    injectLLMForTests(async () => {
      return [
        '# Diff vs baseline',
        '',
        '## Resumen',
        'Sin novedades.',
        '',
        '## Recomendaciones',
        '- Mantener seguimiento',
      ].join('\n')
    })
    const input: BaselineDiffInput = {
      projectName: 'P',
      baseline: {
        capturedAt: '2026-04-15T00:00:00.000Z',
        label: null,
        version: 1,
        tasks: [],
      },
      current: { asOf: NOW.toISOString(), tasks: [] },
    }
    const out = await generateBaselineDiffSummary(input, NOW)
    expect(out.source).toBe('llm')
    expect(out.headline).toBe('Diff vs baseline')
  })

  it('cae a heurística si el LLM falla', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    injectLLMForTests(async () => {
      throw new Error('[BOOM]')
    })
    const input: BaselineDiffInput = {
      projectName: 'P',
      baseline: {
        capturedAt: '2026-04-15T00:00:00.000Z',
        label: null,
        version: 1,
        tasks: [],
      },
      current: { asOf: NOW.toISOString(), tasks: [] },
    }
    const out = await generateBaselineDiffSummary(input, NOW)
    expect(out.source).toBe('heuristic')
    errSpy.mockRestore()
  })
})
