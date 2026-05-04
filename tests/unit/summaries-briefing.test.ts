import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  generateExecutiveBriefing,
  generateExecutiveBriefingHeuristic,
} from '@/lib/ai/summaries/executive-briefing'
import { injectLLMForTests } from '@/lib/ai/summaries/prompts'
import type { PortfolioReport } from '@/lib/reports/portfolio'

/**
 * Ola P7 · Equipo P7-3 · Tests del executive briefing.
 */

const NOW = new Date('2026-05-04T10:00:00Z')

function buildPortfolio(over: Partial<PortfolioReport> = {}): PortfolioReport {
  return {
    generatedAt: NOW.toISOString(),
    rows: [],
    summary: {
      totalProjects: 0,
      healthBreakdown: { green: 0, yellow: 0, red: 0, gray: 0 },
      activeProjects: 0,
      completedProjects: 0,
      avgProgress: 0,
      avgSPI: null,
      avgCPI: null,
    },
    ...over,
  }
}

afterEach(() => {
  injectLLMForTests(null)
})

describe('executive-briefing · heurística', () => {
  it('detecta "saludable" cuando todo está en verde', () => {
    const portfolio = buildPortfolio({
      summary: {
        totalProjects: 5,
        healthBreakdown: { green: 5, yellow: 0, red: 0, gray: 0 },
        activeProjects: 5,
        completedProjects: 0,
        avgProgress: 70,
        avgSPI: 1.05,
        avgCPI: 1.0,
      },
    })
    const out = generateExecutiveBriefingHeuristic({ portfolio }, NOW)
    expect(out.headline).toContain('saludable')
    expect(out.markdown).toContain('## Estado general')
    expect(out.markdown).toContain('## Decisión requerida')
    expect(out.markdown).toContain('Mantener curso')
  })

  it('señala proyectos críticos en el headline cuando hay rojos', () => {
    const portfolio = buildPortfolio({
      summary: {
        totalProjects: 4,
        healthBreakdown: { green: 1, yellow: 1, red: 2, gray: 0 },
        activeProjects: 4,
        completedProjects: 0,
        avgProgress: 50,
        avgSPI: 0.85,
        avgCPI: 0.95,
      },
      rows: [
        {
          id: 'a',
          name: 'Proyecto Alfa',
          status: 'ACTIVE',
          health: 'red',
          spi: 0.6,
          cpi: 0.8,
          cv: -1000,
          progressPercent: 30,
          totalTasks: 10,
          completedTasks: 3,
          nextMilestone: null,
          evm: null,
        },
        {
          id: 'b',
          name: 'Proyecto Beta',
          status: 'ACTIVE',
          health: 'red',
          spi: 0.7,
          cpi: 0.9,
          cv: -500,
          progressPercent: 40,
          totalTasks: 8,
          completedTasks: 3,
          nextMilestone: null,
          evm: null,
        },
        {
          id: 'c',
          name: 'Proyecto Gamma',
          status: 'ACTIVE',
          health: 'yellow',
          spi: 0.95,
          cpi: 1.0,
          cv: 0,
          progressPercent: 60,
          totalTasks: 5,
          completedTasks: 3,
          nextMilestone: null,
          evm: null,
        },
        {
          id: 'd',
          name: 'Proyecto Delta',
          status: 'ACTIVE',
          health: 'green',
          spi: 1.05,
          cpi: 1.05,
          cv: 100,
          progressPercent: 80,
          totalTasks: 5,
          completedTasks: 4,
          nextMilestone: null,
          evm: null,
        },
      ],
    })
    const out = generateExecutiveBriefingHeuristic({ portfolio }, NOW)
    expect(out.headline).toContain('crítico')
    expect(out.markdown).toContain('Proyecto Alfa')
    expect(out.markdown).toContain('Proyecto Beta')
    expect(out.markdown).toContain('Top 3 proyectos en riesgo')
    expect(out.markdown).toContain('Oportunidades')
    expect(out.markdown).toContain('Proyecto Delta')
    expect(out.recommendations.some((r) => /comité/i.test(r))).toBe(true)
  })

  it('avisa cuando SPI promedio está debajo del umbral', () => {
    const portfolio = buildPortfolio({
      summary: {
        totalProjects: 3,
        healthBreakdown: { green: 0, yellow: 3, red: 0, gray: 0 },
        activeProjects: 3,
        completedProjects: 0,
        avgProgress: 50,
        avgSPI: 0.8,
        avgCPI: 0.95,
      },
    })
    const out = generateExecutiveBriefingHeuristic({ portfolio }, NOW)
    expect(out.recommendations.some((r) => /SPI/i.test(r))).toBe(true)
  })

  it('marca proyectos sin datos de presupuesto', () => {
    const portfolio = buildPortfolio({
      summary: {
        totalProjects: 5,
        healthBreakdown: { green: 2, yellow: 0, red: 0, gray: 3 },
        activeProjects: 5,
        completedProjects: 0,
        avgProgress: 50,
        avgSPI: null,
        avgCPI: null,
      },
    })
    const out = generateExecutiveBriefingHeuristic({ portfolio }, NOW)
    expect(out.recommendations.some((r) => /sin datos/i.test(r))).toBe(true)
  })
})

describe('executive-briefing · LLM mock', () => {
  it('usa el LLM cuando responde válido', async () => {
    injectLLMForTests(async () => {
      return [
        '# Portafolio crítico',
        '',
        '## Estado general',
        'Tres rojos.',
        '',
        '## Recomendaciones',
        '- Reasignar recursos',
      ].join('\n')
    })
    const out = await generateExecutiveBriefing(
      { portfolio: buildPortfolio() },
      NOW,
    )
    expect(out.source).toBe('llm')
    expect(out.headline).toBe('Portafolio crítico')
    expect(out.recommendations).toContain('Reasignar recursos')
  })

  it('cae a heurística si el LLM lanza', async () => {
    const errSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    injectLLMForTests(async () => {
      throw new Error('[LLM_TIMEOUT]')
    })
    const out = await generateExecutiveBriefing(
      { portfolio: buildPortfolio() },
      NOW,
    )
    expect(out.source).toBe('heuristic')
    errSpy.mockRestore()
  })
})
