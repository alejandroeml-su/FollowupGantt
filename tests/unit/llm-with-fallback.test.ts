import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wave P7 · Equipo P7-1 — Tests de `withFallback`.
 *
 * Mockeamos `@/lib/ai/llm/client` para controlar el estado del provider
 * (enabled/disabled) y `@sentry/nextjs` para capturar breadcrumbs sin
 * un DSN real. Los tests cubren:
 *   - LLM disabled → directo a heurística (sin invocar llmFn).
 *   - LLM enabled + llmFn ok → source=llm.
 *   - LLM enabled + llmFn lanza LLMError → fallback con código en reason.
 *   - LLM enabled + llmFn lanza Error genérico → fallback PROVIDER_ERROR.
 *   - Confianza por default LLM/heuristic.
 *   - heuristicFn síncrona o async, ambas válidas.
 *   - silent=true no llama Sentry.
 */

// Mock client: variables del estado del config controladas por test.
let mockConfig = {
  provider: 'anthropic' as 'anthropic' | 'openai' | 'disabled',
  model: 'm',
  maxTokens: 2048,
  temperature: 0.2,
  enabled: true,
}

vi.mock('@/lib/ai/llm/client', () => ({
  getLLMConfig: () => mockConfig,
  getLLMClient: vi.fn(),
  __resetLLMClient: vi.fn(),
}))

const sentryAddBreadcrumb = vi.fn()
const sentryCaptureMessage = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: (...args: unknown[]) => sentryAddBreadcrumb(...args),
  captureMessage: (...args: unknown[]) => sentryCaptureMessage(...args),
}))

const { withFallback } = await import('@/lib/ai/llm/with-fallback')
const { LLMError, LLM_ERROR_CODES } = await import('@/lib/ai/llm/types')
const { getLLMMetrics, resetLLMMetrics } = await import('@/lib/ai/llm/metrics')

beforeEach(() => {
  resetLLMMetrics()
  sentryAddBreadcrumb.mockReset()
  sentryCaptureMessage.mockReset()
  mockConfig = {
    provider: 'anthropic',
    model: 'm',
    maxTokens: 2048,
    temperature: 0.2,
    enabled: true,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('withFallback · LLM disabled', () => {
  it('NO invoca llmFn cuando enabled=false', async () => {
    mockConfig.enabled = false
    const llmFn = vi.fn()
    const r = await withFallback(
      llmFn,
      () => ({ output: 'h', confidence: 0.5 }),
      { name: 'op' },
    )
    expect(llmFn).not.toHaveBeenCalled()
    expect(r.source).toBe('heuristic')
    expect(r.output).toBe('h')
    expect(r.confidence).toBe(0.5)
    expect(r.provider).toBe('disabled')
  })

  it('NO invoca llmFn cuando provider=disabled', async () => {
    mockConfig.provider = 'disabled'
    const llmFn = vi.fn()
    const r = await withFallback(
      llmFn,
      () => ({ output: 42 }),
      { name: 'op' },
    )
    expect(llmFn).not.toHaveBeenCalled()
    expect(r.source).toBe('heuristic')
    expect(r.confidence).toBe(0.6) // default heuristic confidence
  })

  it('respeta defaultHeuristicConfidence', async () => {
    mockConfig.provider = 'disabled'
    const r = await withFallback(
      vi.fn(),
      () => ({ output: 'x' }),
      { name: 'op', defaultHeuristicConfidence: 0.8 },
    )
    expect(r.confidence).toBe(0.8)
  })
})

describe('withFallback · LLM ok', () => {
  it('llmFn exitosa → source=llm con default confidence', async () => {
    const r = await withFallback(
      async () => ({ output: { x: 1 } }),
      () => ({ output: { x: 99 } }),
      { name: 'op' },
    )
    expect(r.source).toBe('llm')
    expect(r.output).toEqual({ x: 1 })
    expect(r.confidence).toBe(0.85) // default
    expect(r.provider).toBe('anthropic')
  })

  it('llmFn devuelve confidence propia → la usa', async () => {
    const r = await withFallback(
      async () => ({ output: 'x', confidence: 0.42 }),
      () => ({ output: 'h' }),
      { name: 'op' },
    )
    expect(r.confidence).toBe(0.42)
  })

  it('llmFn devuelve provider override → lo conserva', async () => {
    const r = await withFallback(
      async () => ({ output: 'x', provider: 'openai' as const }),
      () => ({ output: 'h' }),
      { name: 'op' },
    )
    expect(r.provider).toBe('openai')
  })
})

describe('withFallback · LLM falla', () => {
  it('LLMError(TIMEOUT) → fallback con reason llm-error:LLM_TIMEOUT', async () => {
    const r = await withFallback(
      async () => {
        throw new LLMError(LLM_ERROR_CODES.TIMEOUT, 'too slow')
      },
      (reason) => ({ output: 'h', reason }),
      { name: 'op' },
    )
    expect(r.source).toBe('heuristic')
    expect(r.reason).toBe('llm-error:LLM_TIMEOUT')
  })

  it('Error genérico → fallback con reason PROVIDER_ERROR', async () => {
    const r = await withFallback(
      async () => {
        throw new Error('boom')
      },
      (reason) => ({ output: 'h', reason }),
      { name: 'op' },
    )
    expect(r.reason).toBe('llm-error:LLM_PROVIDER_ERROR')
  })

  it('llama Sentry breadcrumb + captureMessage por default', async () => {
    await withFallback(
      async () => {
        throw new LLMError(LLM_ERROR_CODES.RATE_LIMIT, 'slow down')
      },
      () => ({ output: 'h' }),
      { name: 'op' },
    )
    expect(sentryAddBreadcrumb).toHaveBeenCalledTimes(1)
    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1)
    expect(sentryCaptureMessage.mock.calls[0]?.[0]).toContain('LLM_RATE_LIMIT')
  })

  it('silent=true NO llama Sentry', async () => {
    await withFallback(
      async () => {
        throw new LLMError(LLM_ERROR_CODES.TIMEOUT, 'x')
      },
      () => ({ output: 'h' }),
      { name: 'op', silent: true },
    )
    expect(sentryAddBreadcrumb).not.toHaveBeenCalled()
    expect(sentryCaptureMessage).not.toHaveBeenCalled()
  })

  it('registra fallback en métricas', async () => {
    await withFallback(
      async () => {
        throw new LLMError(LLM_ERROR_CODES.TIMEOUT, 'x')
      },
      () => ({ output: 'h' }),
      { name: 'op', silent: true },
    )
    const m = getLLMMetrics()
    expect(m.totals.fallbacks).toBe(1)
  })

  it('heuristicFn async también funciona', async () => {
    const r = await withFallback(
      async () => {
        throw new LLMError(LLM_ERROR_CODES.TIMEOUT, 'x')
      },
      async () => Promise.resolve({ output: 'async-h', confidence: 0.7 }),
      { name: 'op', silent: true },
    )
    expect(r.output).toBe('async-h')
    expect(r.confidence).toBe(0.7)
  })
})
