import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * Wave P7 · Equipo P7-1 — Tests de `generateLLM`.
 *
 * Mockea:
 *   - `ai`: stubs de `generateText` y `generateObject`.
 *   - `@/lib/ai/llm/client`: devuelve un `ResolvedLLMClient` falso o null.
 *
 * Cobertura:
 *   - Happy path text (sin schema) → output string + usage.
 *   - Happy path object (con schema zod) → output tipado.
 *   - Cliente null → LLMError(NO_CLIENT).
 *   - Timeout/abort → LLMError(TIMEOUT).
 *   - Rate limit (mensaje "rate limit") → LLMError(RATE_LIMIT).
 *   - HTTP 429 en mensaje → LLMError(RATE_LIMIT).
 *   - Invalid response (NoObjectGenerated) → LLMError(INVALID_RESPONSE).
 *   - PII redaction se aplica al prompt antes de llamar al SDK.
 *   - Métricas se incrementan en éxito y en error.
 */

const generateTextMock = vi.fn()
const generateObjectMock = vi.fn()

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}))

let mockClient: {
  config: {
    provider: 'anthropic' | 'openai' | 'disabled'
    model: string
    maxTokens: number
    temperature: number
    enabled: boolean
  }
  languageModel: unknown
} | null = {
  config: {
    provider: 'anthropic',
    model: 'claude-test',
    maxTokens: 1024,
    temperature: 0.2,
    enabled: true,
  },
  languageModel: { kind: 'fake-model' },
}

vi.mock('@/lib/ai/llm/client', () => ({
  getLLMClient: async () => mockClient,
  getLLMConfig: () => mockClient?.config ?? {
    provider: 'disabled',
    model: '',
    maxTokens: 2048,
    temperature: 0.2,
    enabled: false,
  },
}))

const { generateLLM, generateLLMText } = await import('@/lib/ai/llm/generate')
const { LLMError } = await import('@/lib/ai/llm/types')
const { getLLMMetrics, resetLLMMetrics } = await import('@/lib/ai/llm/metrics')

beforeEach(() => {
  resetLLMMetrics()
  generateTextMock.mockReset()
  generateObjectMock.mockReset()
  mockClient = {
    config: {
      provider: 'anthropic',
      model: 'claude-test',
      maxTokens: 1024,
      temperature: 0.2,
      enabled: true,
    },
    languageModel: { kind: 'fake-model' },
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('generateLLM · text', () => {
  it('happy path: devuelve output string + usage normalizado', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'hello world',
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    })
    const r = await generateLLM({ prompt: 'hola' })
    expect(r.output).toBe('hello world')
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 })
    expect(r.cached).toBe(false)
    expect(r.fallback).toBe(false)
    expect(r.provider).toBe('anthropic')
  })

  it('aplica redactPII al prompt antes de mandarlo al SDK', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })
    await generateLLM({ prompt: 'mi email es ana@example.com' })
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const call = generateTextMock.mock.calls[0]?.[0] as { prompt: string }
    expect(call.prompt).toBe('mi email es [EMAIL]')
  })

  it('generateLLMText es atajo al output', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'shortcut',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })
    const out = await generateLLMText('hola')
    expect(out).toBe('shortcut')
  })

  it('soporta usage legacy (promptTokens/completionTokens)', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'x',
      usage: { promptTokens: 7, completionTokens: 3 },
    })
    const r = await generateLLM({ prompt: 'p' })
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 3, totalTokens: 10 })
  })

  it('respeta temperatureOverride y maxTokensOverride', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'x',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })
    await generateLLM({
      prompt: 'p',
      temperatureOverride: 0,
      maxTokensOverride: 256,
    })
    const call = generateTextMock.mock.calls[0]?.[0] as { temperature: number; maxOutputTokens: number }
    expect(call.temperature).toBe(0)
    expect(call.maxOutputTokens).toBe(256)
  })
})

describe('generateLLM · object schema', () => {
  it('devuelve output tipado cuando hay schema', async () => {
    const schema = z.object({ category: z.enum(['BUG', 'TASK']), confidence: z.number() })
    generateObjectMock.mockResolvedValueOnce({
      object: { category: 'BUG', confidence: 0.9 },
      usage: { inputTokens: 4, outputTokens: 8, totalTokens: 12 },
    })
    const r = await generateLLM({ prompt: 'classify', schema })
    expect(r.output).toEqual({ category: 'BUG', confidence: 0.9 })
    expect(r.usage.totalTokens).toBe(12)
  })

  it('pasa el schema al SDK', async () => {
    const schema = z.object({ x: z.string() })
    generateObjectMock.mockResolvedValueOnce({
      object: { x: 'hi' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })
    await generateLLM({ prompt: 'p', schema })
    const call = generateObjectMock.mock.calls[0]?.[0] as { schema: unknown }
    expect(call.schema).toBe(schema)
  })
})

describe('generateLLM · errores', () => {
  it('throws LLM_NO_CLIENT cuando getLLMClient retorna null', async () => {
    mockClient = null
    await expect(generateLLM({ prompt: 'p' })).rejects.toThrow(LLMError)
    await expect(generateLLM({ prompt: 'p' })).rejects.toMatchObject({
      code: 'LLM_NO_CLIENT',
    })
  })

  it('mapea AbortError a LLM_TIMEOUT', async () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    generateTextMock.mockRejectedValueOnce(err)
    await expect(generateLLM({ prompt: 'p' })).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
    })
  })

  it('mapea "rate limit" a LLM_RATE_LIMIT', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('Rate limit exceeded for org'))
    await expect(generateLLM({ prompt: 'p' })).rejects.toMatchObject({
      code: 'LLM_RATE_LIMIT',
    })
  })

  it('mapea HTTP 429 a LLM_RATE_LIMIT', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('Provider returned 429 Too Many Requests'))
    await expect(generateLLM({ prompt: 'p' })).rejects.toMatchObject({
      code: 'LLM_RATE_LIMIT',
    })
  })

  it('mapea NoObjectGeneratedError a LLM_INVALID_RESPONSE', async () => {
    const err = new Error('NoObjectGeneratedError: model returned junk')
    err.name = 'NoObjectGeneratedError'
    generateObjectMock.mockRejectedValueOnce(err)
    await expect(generateLLM({ prompt: 'p', schema: z.object({ x: z.string() }) })).rejects.toMatchObject({
      code: 'LLM_INVALID_RESPONSE',
    })
  })

  it('catch-all → LLM_PROVIDER_ERROR', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('weird kaboom'))
    await expect(generateLLM({ prompt: 'p' })).rejects.toMatchObject({
      code: 'LLM_PROVIDER_ERROR',
    })
  })

  it('registra error en métricas', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('boom'))
    await expect(generateLLM({ prompt: 'p' })).rejects.toThrow()
    const m = getLLMMetrics()
    expect(m.byModel['claude-test']?.errors).toBe(1)
  })
})

describe('generateLLM · métricas en éxito', () => {
  it('incrementa calls + tokensIn + tokensOut', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'x',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    })
    await generateLLM({ prompt: 'p' })
    const m = getLLMMetrics()
    expect(m.byModel['claude-test']).toMatchObject({
      calls: 1,
      tokensIn: 100,
      tokensOut: 50,
    })
  })
})
