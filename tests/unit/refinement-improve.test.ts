import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Wave P7 · Equipo P7-5 — Tests de "Mejorar descripción" + adapter LLM.
 *
 * Cubrimos:
 *   - Validación zod del schema de salida.
 *   - Heurística de fallback determinista.
 *   - Camino LLM mockeando `ai/generateObject` y `@ai-sdk/anthropic`.
 *   - Cache TTL: misma llamada dentro del TTL no re-invoca al modelo.
 *   - LLMDisabledError → cae a heurística.
 *   - Error del modelo → cae a heurística.
 */

import {
  ImproveDescriptionSchema,
} from '@/lib/ai/refinement/schemas'

// Mocks del SDK de IA (lazy-loaded por el adapter).
const generateObjectMock = vi.fn()
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}))
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelId: string) => ({ modelId })),
}))

beforeEach(() => {
  generateObjectMock.mockReset()
  // Limpiar cache entre tests para aislamiento.
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
})

describe('ImproveDescriptionSchema', () => {
  it('acepta una salida válida', () => {
    const r = ImproveDescriptionSchema.safeParse({
      improvedDescription:
        'Diseñar el dashboard ejecutivo con KPIs principales del proyecto.',
      acceptanceCriteria: [
        'Definir los 5 KPIs prioritarios',
        'Maquetar el layout en Figma',
      ],
      risks: ['Cambios de scope tardíos'],
    })
    expect(r.success).toBe(true)
  })

  it('rechaza descripción muy corta', () => {
    const r = ImproveDescriptionSchema.safeParse({
      improvedDescription: 'corto',
      acceptanceCriteria: [],
      risks: [],
    })
    expect(r.success).toBe(false)
  })

  it('acepta arrays con cualquier longitud (límite 8 vía system prompt)', () => {
    // Wave P14b: Anthropic structured output rechaza maxItems · el límite
    // de 8 criterios se enforced en el system prompt y heurística.
    const r = ImproveDescriptionSchema.safeParse({
      improvedDescription: 'Una descripción razonablemente larga.',
      acceptanceCriteria: Array.from({ length: 9 }, (_, i) => `crit ${i}`),
      risks: [],
    })
    expect(r.success).toBe(true)
  })
})

describe('improveDescriptionHeuristic', () => {
  it('produce un resultado consistente con criterios y riesgos', async () => {
    const { improveDescriptionHeuristic } = await import(
      '@/lib/ai/refinement/improve-description'
    )
    const r = improveDescriptionHeuristic({ title: 'Migrar pipeline CI' })
    expect(r.improvedDescription.length).toBeGreaterThan(20)
    expect(r.acceptanceCriteria.length).toBeGreaterThanOrEqual(3)
    expect(r.risks.length).toBeGreaterThanOrEqual(1)
    // valida zod
    expect(ImproveDescriptionSchema.safeParse(r).success).toBe(true)
  })

  it('respeta la descripción actual cuando existe', async () => {
    const { improveDescriptionHeuristic } = await import(
      '@/lib/ai/refinement/improve-description'
    )
    const r = improveDescriptionHeuristic({
      title: 'X',
      currentDescription: 'Texto previo del usuario',
    })
    expect(r.improvedDescription).toContain('Texto previo del usuario')
  })
})

describe('improveDescription · sin API key', () => {
  it('cae a heurística marcada con source=heuristic', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { improveDescription } = await import(
      '@/lib/ai/refinement/improve-description'
    )
    const out = await improveDescription({ title: 'Tarea X' })
    expect(out.source).toBe('heuristic')
    expect(out.fallbackReason).toContain('ANTHROPIC_API_KEY')
    expect(out.data.improvedDescription).toBeTruthy()
    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  it('lanza si el título está vacío', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { improveDescription } = await import(
      '@/lib/ai/refinement/improve-description'
    )
    await expect(improveDescription({ title: '   ' })).rejects.toThrow(
      /INVALID_INPUT/,
    )
  })
})

describe('improveDescription · con API key (LLM)', () => {
  it('llama a generateObject y cachea el segundo intento', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const { clearRefinementCache } = await import(
      '@/lib/ai/refinement/prompts'
    )
    clearRefinementCache()
    generateObjectMock.mockResolvedValue({
      object: {
        improvedDescription:
          'Implementar el módulo de notificaciones push con suscripciones por proyecto.',
        acceptanceCriteria: ['Endpoint /subscribe', 'Persistir suscripción'],
        risks: ['Compatibilidad con iOS Safari'],
      },
    })
    const { improveDescription } = await import(
      '@/lib/ai/refinement/improve-description'
    )

    const out1 = await improveDescription({
      title: 'Push notifications',
      currentDescription: null,
    })
    expect(out1.source).toBe('llm')
    expect(generateObjectMock).toHaveBeenCalledTimes(1)

    // Segunda llamada idéntica → cache hit, no se vuelve a llamar el modelo.
    const out2 = await improveDescription({
      title: 'Push notifications',
      currentDescription: null,
    })
    expect(out2.source).toBe('llm')
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  it('cae a heurística si generateObject lanza error', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const { clearRefinementCache } = await import(
      '@/lib/ai/refinement/prompts'
    )
    clearRefinementCache()
    generateObjectMock.mockRejectedValueOnce(new Error('boom'))
    const { improveDescription } = await import(
      '@/lib/ai/refinement/improve-description'
    )
    const out = await improveDescription({
      title: 'Otra tarea cualquiera',
    })
    expect(out.source).toBe('heuristic')
    expect(out.fallbackReason).toContain('falló')
  })
})
