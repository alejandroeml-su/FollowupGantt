import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  generateStatusNarrative,
  generateStatusNarrativeHeuristic,
} from '@/lib/ai/summaries/status-narrative'
import { injectLLMForTests } from '@/lib/ai/summaries/prompts'
import type { StatusReportPayload } from '@/lib/actions/reports'

/**
 * Ola P7 · Equipo P7-3 · Tests de status narrative.
 *
 * Cobertura:
 *  - heurística determinística (estructura, headline, recomendaciones)
 *  - LLM mockeado feliz (parseo correcto)
 *  - LLM falla → fallback heurístico
 *  - LLM devuelve vacío → fallback
 */

const NOW = new Date('2026-05-04T10:00:00Z')

function buildReport(over: Partial<StatusReportPayload> = {}): StatusReportPayload {
  return {
    projectId: 'p-1',
    projectName: 'Proyecto X',
    weekOfYear: '2026-W19',
    periodStart: '2026-05-04T00:00:00.000Z',
    periodEnd: '2026-05-10T00:00:00.000Z',
    generatedAt: NOW.toISOString(),
    summary: {
      totalTasks: 10,
      completedTasks: 4,
      progressPercent: 40,
      upcomingMilestones: [],
    },
    criticalPath: [],
    delayedTasks: [],
    topRisks: [],
    project: { id: 'p-1', name: 'Proyecto X', status: 'ACTIVE' },
    ...over,
  }
}

afterEach(() => {
  injectLLMForTests(null)
})

describe('status-narrative · heurística', () => {
  it('genera markdown con estructura completa (sin atrasos)', () => {
    const report = buildReport()
    const out = generateStatusNarrativeHeuristic({ report, period: 'week' }, NOW)
    expect(out.source).toBe('heuristic')
    expect(out.headline).toContain('Proyecto X')
    expect(out.headline).toContain('40%')
    expect(out.markdown).toContain('## Contexto')
    expect(out.markdown).toContain('## Logros del periodo')
    expect(out.markdown).toContain('## Alertas')
    expect(out.markdown).toContain('## Próximos pasos')
    expect(out.markdown).toContain('## Recomendaciones')
    expect(out.keyPoints.length).toBeGreaterThanOrEqual(2)
  })

  it('lista las 3 tareas más atrasadas en alertas', () => {
    const report = buildReport({
      delayedTasks: [
        { id: 'a', title: 'Tarea A', endDate: '2026-04-01', daysOverdue: 33, progress: 50, owner: 'Ana' },
        { id: 'b', title: 'Tarea B', endDate: '2026-04-15', daysOverdue: 19, progress: 10, owner: null },
        { id: 'c', title: 'Tarea C', endDate: '2026-04-20', daysOverdue: 14, progress: 20, owner: 'Carlos' },
        { id: 'd', title: 'Tarea D', endDate: '2026-04-30', daysOverdue: 4, progress: 80, owner: 'Daniel' },
      ],
    })
    const out = generateStatusNarrativeHeuristic({ report, period: 'week' }, NOW)
    expect(out.markdown).toContain('Tarea A')
    expect(out.markdown).toContain('Tarea B')
    expect(out.markdown).toContain('Tarea C')
    // top 3 → no incluye Tarea D en alertas
    const alertSection = out.markdown.split('## Próximos pasos')[0]
    expect(alertSection.includes('Tarea D')).toBe(false)
    // headline refleja atrasos
    expect(out.headline).toContain('4 tarea(s) atrasada(s)')
  })

  it('incluye recomendación de revisión de alcance cuando avance < 50%', () => {
    const report = buildReport({
      summary: {
        totalTasks: 5,
        completedTasks: 1,
        progressPercent: 20,
        upcomingMilestones: [],
      },
    })
    const out = generateStatusNarrativeHeuristic({ report, period: 'week' }, NOW)
    expect(out.recommendations.some((r) => /alcance/i.test(r))).toBe(true)
  })

  it('genera próximos pasos concretos con hitos próximos', () => {
    const report = buildReport({
      summary: {
        totalTasks: 5,
        completedTasks: 3,
        progressPercent: 80,
        upcomingMilestones: [
          { id: 'm1', title: 'Cierre fase 1', endDate: '2026-05-08', daysUntil: 4 },
        ],
      },
    })
    const out = generateStatusNarrativeHeuristic({ report, period: 'week' }, NOW)
    expect(out.markdown).toContain('hito(s)')
  })

  it('etiqueta period correctamente (mensual)', () => {
    const report = buildReport()
    const out = generateStatusNarrativeHeuristic({ report, period: 'month' }, NOW)
    expect(out.markdown).toContain('mensual')
  })
})

describe('status-narrative · LLM con mock', () => {
  it('usa el LLM cuando devuelve markdown válido', async () => {
    injectLLMForTests(async () => {
      return [
        '# Proyecto X: avance saludable',
        '',
        '## Contexto',
        'El proyecto va al 40%.',
        '',
        '## Recomendaciones',
        '- Mantener cadencia',
        '- Revisar dependencias',
      ].join('\n')
    })
    const out = await generateStatusNarrative(
      { report: buildReport(), period: 'week' },
      NOW,
    )
    expect(out.source).toBe('llm')
    expect(out.headline).toBe('Proyecto X: avance saludable')
    expect(out.recommendations).toContain('Mantener cadencia')
  })

  it('cae a heurística cuando el LLM lanza error', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    injectLLMForTests(async () => {
      throw new Error('[LLM_TIMEOUT] simulated')
    })
    const out = await generateStatusNarrative(
      { report: buildReport(), period: 'week' },
      NOW,
    )
    expect(out.source).toBe('heuristic')
    errSpy.mockRestore()
  })

  it('cae a heurística cuando el LLM devuelve string vacío', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    injectLLMForTests(async () => '   ')
    const out = await generateStatusNarrative(
      { report: buildReport(), period: 'week' },
      NOW,
    )
    expect(out.source).toBe('heuristic')
    errSpy.mockRestore()
  })

  it('respeta el threshold y headline del LLM aunque incluya bullets', async () => {
    injectLLMForTests(async () => {
      return [
        '## Subtitular sin H1',
        'Texto.',
        '',
        '- punto 1',
        '- punto 2',
        '',
        '## Recomendaciones',
        '- Acción A',
      ].join('\n')
    })
    const out = await generateStatusNarrative(
      { report: buildReport(), period: 'week' },
      NOW,
    )
    expect(out.source).toBe('llm')
    expect(out.headline).toBe('Subtitular sin H1')
    expect(out.recommendations).toEqual(['Acción A'])
    expect(out.keyPoints).toContain('punto 1')
  })
})

describe('status-narrative · determinismo', () => {
  let now: Date
  beforeEach(() => {
    now = new Date('2026-05-04T10:00:00Z')
  })
  it('produce el mismo markdown para el mismo input', () => {
    const report = buildReport({
      delayedTasks: [
        { id: 'a', title: 'Tarea A', endDate: null, daysOverdue: 5, progress: 0, owner: null },
      ],
    })
    const a = generateStatusNarrativeHeuristic({ report, period: 'week' }, now)
    const b = generateStatusNarrativeHeuristic({ report, period: 'week' }, now)
    expect(a.markdown).toBe(b.markdown)
    expect(a.generatedAt).toBe(b.generatedAt)
  })
})
