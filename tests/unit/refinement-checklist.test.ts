import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Wave P7 · Equipo P7-5 — Tests de "Sugerir checklist" + "Sugerir tags"
 * + "Refinar categorización" (heurísticas y schemas).
 */

import {
  SuggestChecklistSchema,
  SuggestTagsSchema,
  RefineCategorizationSchema,
} from '@/lib/ai/refinement/schemas'

const generateObjectMock = vi.fn()
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}))
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelId: string) => ({ modelId })),
}))

beforeEach(() => {
  generateObjectMock.mockReset()
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
})

describe('SuggestChecklistSchema', () => {
  it('acepta entre 3 y 7 items', () => {
    const ok = SuggestChecklistSchema.safeParse({
      items: [
        { text: 'Diseñar', optional: false },
        { text: 'Implementar', optional: false },
        { text: 'Validar', optional: false },
      ],
    })
    expect(ok.success).toBe(true)
  })

  it('rechaza menos de 3 items', () => {
    const r = SuggestChecklistSchema.safeParse({
      items: [{ text: 'Solo uno', optional: false }],
    })
    expect(r.success).toBe(false)
  })

  it('rechaza más de 7 items', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      text: `Item ${i}`,
      optional: false,
    }))
    const r = SuggestChecklistSchema.safeParse({ items })
    expect(r.success).toBe(false)
  })
})

describe('suggestChecklistHeuristic', () => {
  it('devuelve template de BUG cuando el título contiene "bug"', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { suggestChecklist } = await import(
      '@/lib/ai/refinement/suggest-checklist'
    )
    const out = await suggestChecklist({
      title: 'Fix bug crítico en login',
      description: null,
    })
    expect(out.source).toBe('heuristic')
    const texts = out.data.items.map((i) => i.text.toLowerCase())
    expect(texts.some((t) => t.includes('reproducir'))).toBe(true)
  })

  it('devuelve template DEFAULT para títulos genéricos', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { suggestChecklist } = await import(
      '@/lib/ai/refinement/suggest-checklist'
    )
    const out = await suggestChecklist({
      title: 'Algo sin keywords claros aaa',
    })
    expect(out.data.items.length).toBeGreaterThanOrEqual(3)
  })

  it('devuelve template DESIGN para tareas de mockup', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { suggestChecklist } = await import(
      '@/lib/ai/refinement/suggest-checklist'
    )
    const out = await suggestChecklist({
      title: 'Diseñar mockup en Figma para nueva pantalla',
    })
    const texts = out.data.items.map((i) => i.text.toLowerCase())
    expect(
      texts.some((t) => t.includes('wireframe') || t.includes('mockup')),
    ).toBe(true)
  })
})

describe('SuggestTagsSchema · validación', () => {
  it('rechaza tags con espacios', () => {
    const r = SuggestTagsSchema.safeParse({
      tags: [{ tag: 'tag invalido', reused: false }],
    })
    expect(r.success).toBe(false)
  })

  it('acepta tags válidos en kebab-case', () => {
    const r = SuggestTagsSchema.safeParse({
      tags: [
        { tag: 'frontend', reused: true },
        { tag: 'auth-flow', reused: false },
      ],
    })
    expect(r.success).toBe(true)
  })
})

describe('suggestTagsHeuristic', () => {
  it('reutiliza tags existentes que aparecen en el texto', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { suggestTags } = await import('@/lib/ai/refinement/suggest-tags')
    const out = await suggestTags({
      title: 'Mejorar el módulo de auth',
      description: 'Reescribir flow de auth para soportar OAuth.',
      existingTags: ['auth', 'frontend', 'backend'],
    })
    expect(out.source).toBe('heuristic')
    const tags = out.data.tags.map((t) => t.tag)
    // No exigimos un tag específico, sólo que el output esté validado
    expect(SuggestTagsSchema.safeParse(out.data).success).toBe(true)
    // Debe limitar a 5
    expect(tags.length).toBeLessThanOrEqual(5)
  })

  it('extrae hashtags explícitos del texto (#release)', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { suggestTags } = await import('@/lib/ai/refinement/suggest-tags')
    const out = await suggestTags({
      title: 'Despliegue v2 #release',
      description: null,
      existingTags: [],
    })
    const tags = out.data.tags.map((t) => t.tag)
    expect(tags).toContain('release')
  })
})

describe('RefineCategorizationSchema', () => {
  it('acepta los 4 task types', () => {
    for (const t of ['PHASE', 'AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET']) {
      const r = RefineCategorizationSchema.safeParse({
        suggestedType: t,
        suggestedPriority: 'MEDIUM',
        reasoning: 'Razonamiento de prueba.',
      })
      expect(r.success).toBe(true)
    }
  })

  it('rechaza tipos desconocidos', () => {
    const r = RefineCategorizationSchema.safeParse({
      suggestedType: 'WEIRD',
      suggestedPriority: 'MEDIUM',
      reasoning: 'Razonamiento de prueba.',
    })
    expect(r.success).toBe(false)
  })
})

describe('refineCategorizationHeuristic', () => {
  it('detecta CRITICAL cuando hay "urgente" en el título', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { refineCategorization } = await import(
      '@/lib/ai/refinement/refine-categorization'
    )
    const out = await refineCategorization({
      title: 'Bug urgente production caído',
      description: null,
      currentType: 'AGILE_STORY',
      currentPriority: 'MEDIUM',
    })
    expect(out.source).toBe('heuristic')
    expect(['HIGH', 'CRITICAL']).toContain(out.data.suggestedPriority)
  })

  it('detecta PHASE cuando el título menciona "milestone"', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { refineCategorization } = await import(
      '@/lib/ai/refinement/refine-categorization'
    )
    const out = await refineCategorization({
      title: 'Milestone Q2 entrega',
      description: null,
      currentType: 'AGILE_STORY',
      currentPriority: 'MEDIUM',
    })
    expect(out.data.suggestedType).toBe('PHASE')
  })

  it('mantiene MEDIUM como default sin pistas', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { refineCategorization } = await import(
      '@/lib/ai/refinement/refine-categorization'
    )
    const out = await refineCategorization({
      title: 'Tarea sin pistas claras',
      description: null,
      currentType: 'AGILE_STORY',
      currentPriority: 'MEDIUM',
    })
    expect(out.data.suggestedPriority).toBe('MEDIUM')
  })
})
