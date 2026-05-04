import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wave P7 · Equipo P7-1 — Tests de `withLLMCache`.
 *
 * Mockea `next/cache` con un `unstable_cache` que SÍ memoriza la
 * respuesta por sus `keyParts`, replicando el contrato real. Esto nos
 * permite validar:
 *   - cache miss en el primer call.
 *   - cache hit en el segundo call (y `cached=true`).
 *   - construcción determinista de la cache key con hash del prompt.
 *   - TTL pasado a `unstable_cache` (`revalidate`).
 *   - tags incluyen `llm:{scope}` + extras.
 */

// Mock que captura los args y reproduce caching real.
const cacheStore = new Map<string, unknown>()
const lastOptions: { tags?: string[]; revalidate?: number; keyParts?: readonly string[] }[] = []

vi.mock('next/cache', () => ({
  unstable_cache: <Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
    keyParts: readonly string[] | undefined,
    options?: { tags?: string[]; revalidate?: number },
  ) => {
    const cacheKey = JSON.stringify(keyParts ?? [])
    lastOptions.push({ tags: options?.tags, revalidate: options?.revalidate, keyParts })
    return async (...args: Args): Promise<R> => {
      const argsKey = `${cacheKey}|${JSON.stringify(args)}`
      if (cacheStore.has(argsKey)) {
        return cacheStore.get(argsKey) as R
      }
      const result = await fn(...args)
      cacheStore.set(argsKey, result)
      return result
    }
  },
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

// Importamos DESPUÉS del mock para que el wrapper use nuestra versión.
const { buildLLMCacheKey, buildLLMCacheTag, withLLMCache, __resetLLMCacheWarmTracking } =
  await import('@/lib/ai/llm/with-cache')
const { resetLLMMetrics, getLLMMetrics } = await import('@/lib/ai/llm/metrics')

beforeEach(() => {
  cacheStore.clear()
  lastOptions.length = 0
  __resetLLMCacheWarmTracking()
  resetLLMMetrics()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('buildLLMCacheKey', () => {
  it('genera keys deterministas para el mismo content', () => {
    const k1 = buildLLMCacheKey({ scope: 'cat', id: 1, model: 'm1', contentToHash: 'p' })
    const k2 = buildLLMCacheKey({ scope: 'cat', id: 1, model: 'm1', contentToHash: 'p' })
    expect(k1).toBe(k2)
  })

  it('cambia la key cuando cambia el content', () => {
    const k1 = buildLLMCacheKey({ scope: 'cat', id: 1, model: 'm1', contentToHash: 'a' })
    const k2 = buildLLMCacheKey({ scope: 'cat', id: 1, model: 'm1', contentToHash: 'b' })
    expect(k1).not.toBe(k2)
  })

  it('cambia la key cuando cambia el modelo', () => {
    const k1 = buildLLMCacheKey({ scope: 'cat', id: 1, model: 'm1', contentToHash: 'p' })
    const k2 = buildLLMCacheKey({ scope: 'cat', id: 1, model: 'm2', contentToHash: 'p' })
    expect(k1).not.toBe(k2)
  })

  it('escapa caracteres no alfanuméricos en el modelo', () => {
    const k = buildLLMCacheKey({
      scope: 'cat',
      id: 1,
      model: 'claude-haiku-4-5-20251001',
      contentToHash: 'x',
    })
    expect(k).toMatch(/^llm:cat:1:claude-haiku-4-5-20251001:[a-f0-9]+$/)
  })

  it('usa "global" cuando no hay id', () => {
    const k = buildLLMCacheKey({ scope: 's', model: 'm', contentToHash: 'c' })
    expect(k).toMatch(/^llm:s:global:m:/)
  })
})

describe('buildLLMCacheTag', () => {
  it('genera tag con prefijo llm:', () => {
    expect(buildLLMCacheTag('summary')).toBe('llm:summary')
  })

  it('cae a "unknown" cuando scope vacío', () => {
    expect(buildLLMCacheTag('')).toBe('llm:unknown')
  })
})

describe('withLLMCache', () => {
  const baseOpts = {
    scope: 'test',
    id: 'p1',
    model: 'claude-haiku-4-5-20251001',
    contentToHash: 'prompt-x',
    ttl: 60,
  } as const

  it('cache miss en el primer call (cached=false) y hit en el segundo (cached=true)', async () => {
    let calls = 0
    const fn = async () => {
      calls += 1
      return {
        output: { msg: 'hello' },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        cached: false,
        fallback: false,
        provider: 'anthropic' as const,
        model: 'claude-haiku-4-5-20251001',
      }
    }

    const r1 = await withLLMCache(fn, baseOpts)
    expect(r1.cached).toBe(false)
    expect(calls).toBe(1)

    const r2 = await withLLMCache(fn, baseOpts)
    expect(r2.cached).toBe(true)
    // La función subyacente NO se vuelve a invocar gracias a unstable_cache.
    expect(calls).toBe(1)
  })

  it('pasa TTL como `revalidate` a unstable_cache', async () => {
    const fn = async () => ({
      output: 'x',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cached: false,
      fallback: false,
      provider: 'anthropic' as const,
      model: 'm',
    })
    await withLLMCache(fn, { ...baseOpts, ttl: 120 })
    expect(lastOptions[0]?.revalidate).toBe(120)
  })

  it('TTL default = 3600 si no se especifica', async () => {
    const fn = async () => ({
      output: 'x',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cached: false,
      fallback: false,
      provider: 'anthropic' as const,
      model: 'm',
    })
    await withLLMCache(fn, { scope: 's', model: 'm', contentToHash: 'c' })
    expect(lastOptions[0]?.revalidate).toBe(3600)
  })

  it('incluye tag llm:{scope} y extraTags', async () => {
    const fn = async () => ({
      output: 'x',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cached: false,
      fallback: false,
      provider: 'anthropic' as const,
      model: 'm',
    })
    await withLLMCache(fn, { ...baseOpts, extraTags: ['project:1'] })
    expect(lastOptions[0]?.tags).toEqual(['llm:test', 'project:1'])
  })

  it('keys diferentes generan miss en ambos calls', async () => {
    let calls = 0
    const fn = async () => {
      calls += 1
      return {
        output: 'x',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        cached: false,
        fallback: false,
        provider: 'anthropic' as const,
        model: 'm',
      }
    }
    await withLLMCache(fn, baseOpts)
    await withLLMCache(fn, { ...baseOpts, contentToHash: 'otro' })
    expect(calls).toBe(2)
  })

  it('registra cacheHit en métricas en el segundo call', async () => {
    const fn = async () => ({
      output: 'x',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      cached: false,
      fallback: false,
      provider: 'anthropic' as const,
      model: 'claude-haiku-4-5-20251001',
    })
    await withLLMCache(fn, baseOpts)
    await withLLMCache(fn, baseOpts)
    const m = getLLMMetrics()
    expect(m.byModel['claude-haiku-4-5-20251001']?.cacheHits).toBe(1)
  })
})
