import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Wave P7 · Equipo P7-5 — Tests de "Detectar duplicados".
 *
 * Cubrimos:
 *   - `titleSimilarity` (Levenshtein normalizado).
 *   - Heurística de fallback con threshold por defecto 0.85.
 *   - Camino LLM con candidatos filtrados por threshold + topN.
 *   - Schema de salida.
 */

import {
  DetectDuplicatesSchema,
  DuplicateCandidateSchema,
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

describe('DuplicateCandidateSchema', () => {
  it('rechaza similarity > 1', () => {
    const r = DuplicateCandidateSchema.safeParse({
      taskId: 't1',
      similarity: 1.5,
      reason: 'x',
    })
    expect(r.success).toBe(false)
  })

  it('acepta similarity en rango', () => {
    const r = DuplicateCandidateSchema.safeParse({
      taskId: 't1',
      similarity: 0.8,
      reason: 'razón',
    })
    expect(r.success).toBe(true)
  })
})

describe('titleSimilarity', () => {
  it('retorna 1 para títulos idénticos', async () => {
    const { titleSimilarity } = await import(
      '@/lib/ai/refinement/detect-duplicates'
    )
    expect(titleSimilarity('Diseñar mockup', 'Diseñar mockup')).toBe(1)
  })

  it('es insensible a mayúsculas y acentos', async () => {
    const { titleSimilarity } = await import(
      '@/lib/ai/refinement/detect-duplicates'
    )
    expect(titleSimilarity('DISEÑAR MOCKUP', 'diseñar mockup')).toBe(1)
    expect(titleSimilarity('disenar', 'diseñar')).toBe(1)
  })

  it('retorna similitud baja para títulos diferentes', async () => {
    const { titleSimilarity } = await import(
      '@/lib/ai/refinement/detect-duplicates'
    )
    const sim = titleSimilarity('Migrar pipeline CI', 'Comprar café')
    expect(sim).toBeLessThan(0.4)
  })

  it('retorna similitud alta para typos pequeños', async () => {
    const { titleSimilarity } = await import(
      '@/lib/ai/refinement/detect-duplicates'
    )
    const sim = titleSimilarity('Implementar login', 'Implementar logn')
    expect(sim).toBeGreaterThan(0.85)
  })
})

describe('detectDuplicatesHeuristic', () => {
  it('encuentra duplicado por título casi idéntico', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { detectDuplicates } = await import(
      '@/lib/ai/refinement/detect-duplicates'
    )
    const out = await detectDuplicates({
      reference: { id: 'a', title: 'Implementar login con OAuth' },
      candidates: [
        { id: 'b', title: 'Implementar login con OAuth' },
        { id: 'c', title: 'Otra tarea distinta' },
      ],
    })
    expect(out.source).toBe('heuristic')
    expect(out.data.candidates.length).toBeGreaterThanOrEqual(1)
    expect(out.data.candidates[0].taskId).toBe('b')
    expect(out.data.candidates[0].similarity).toBeGreaterThan(0.9)
  })

  it('no incluye la referencia entre los duplicados', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { detectDuplicates } = await import(
      '@/lib/ai/refinement/detect-duplicates'
    )
    const out = await detectDuplicates({
      reference: { id: 'a', title: 'X' },
      candidates: [{ id: 'a', title: 'X' }],
    })
    expect(out.data.candidates.find((c) => c.taskId === 'a')).toBeUndefined()
  })

  it('respeta candidates vacíos', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { detectDuplicates } = await import(
      '@/lib/ai/refinement/detect-duplicates'
    )
    const out = await detectDuplicates({
      reference: { id: 'a', title: 'X' },
      candidates: [],
    })
    expect(out.data.candidates).toHaveLength(0)
  })
})

describe('detectDuplicates · con LLM', () => {
  it('filtra candidatos por threshold y limita topN', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const { clearRefinementCache } = await import(
      '@/lib/ai/refinement/prompts'
    )
    clearRefinementCache()
    generateObjectMock.mockResolvedValue({
      object: {
        candidates: [
          { taskId: 'b', similarity: 0.95, reason: 'casi idéntico' },
          { taskId: 'c', similarity: 0.5, reason: 'parcial' },
          { taskId: 'd', similarity: 0.8, reason: 'parecido' },
          { taskId: 'e', similarity: 0.75, reason: 'también parecido' },
        ],
      },
    })
    const { detectDuplicates } = await import(
      '@/lib/ai/refinement/detect-duplicates'
    )
    const out = await detectDuplicates({
      reference: { id: 'a', title: 'Tarea X' },
      candidates: [
        { id: 'b', title: 'Tarea X' },
        { id: 'c', title: 'Diferente' },
        { id: 'd', title: 'Algo' },
        { id: 'e', title: 'Otro' },
      ],
      topN: 2,
    })
    expect(out.source).toBe('llm')
    // Solo 2 con similarity >= 0.7, ordenados desc
    expect(out.data.candidates).toHaveLength(2)
    expect(out.data.candidates[0].taskId).toBe('b')
  })

  it('valida output con DetectDuplicatesSchema', () => {
    const r = DetectDuplicatesSchema.safeParse({
      candidates: [
        { taskId: 't1', similarity: 0.9, reason: 'r' },
      ],
    })
    expect(r.success).toBe(true)
  })
})
