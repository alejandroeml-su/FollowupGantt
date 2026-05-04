/**
 * Ola P7 · Equipo P7-1 · LLM adapter base — Helper `generateLLM`.
 *
 * Wrapper único sobre `generateText` / `generateObject` del SDK `ai`:
 *   - Toma `GenerateOptions` (con o sin schema zod).
 *   - Aplica `redactPII` al `prompt` antes de mandar al provider.
 *   - Aplica timeout (default 30s) con AbortController encadenable.
 *   - Mapea errores del SDK a `LLMError` con códigos tipados.
 *   - Registra métricas (`recordLLMCall` / `recordLLMError`).
 *
 * No incluye cache aquí — eso vive en `with-cache.ts` para mantener
 * separación de responsabilidades.
 *
 * Type safety: el generic `T` se infiere desde `schema` (`z.infer<S>`).
 * Cuando no hay schema, `T = string`.
 */

import { generateObject, generateText, type LanguageModel } from 'ai'
import type { ZodType } from 'zod'

import { getLLMClient } from './client'
import { recordLLMCall, recordLLMError } from './metrics'
import { redactPII } from './redact-pii'
import {
  LLMError,
  LLM_ERROR_CODES,
  type GenerateOptions,
  type LLMResponse,
  type LLMUsage,
} from './types'

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Combina dos AbortSignal en uno: aborta cuando cualquiera lo haga.
 * Polyfill simple porque `AbortSignal.any` puede no estar disponible
 * en todos los runtimes (Node 18 LTS).
 */
function anySignal(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal {
  const ctrl = new AbortController()
  for (const sig of signals) {
    if (!sig) continue
    if (sig.aborted) {
      ctrl.abort(sig.reason)
      return ctrl.signal
    }
    sig.addEventListener(
      'abort',
      () => ctrl.abort(sig.reason),
      { once: true },
    )
  }
  return ctrl.signal
}

/**
 * Mapea un error desconocido (del SDK `ai` o del provider) a un
 * `LLMError` tipado. Heurística por nombre/mensaje porque el SDK no
 * expone una taxonomía exportable única.
 */
function mapToLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err

  const msg = err instanceof Error ? err.message : String(err)
  const name = err instanceof Error ? err.name : ''
  const lower = `${name} ${msg}`.toLowerCase()

  if (lower.includes('abort') || lower.includes('timeout')) {
    return new LLMError(LLM_ERROR_CODES.TIMEOUT, 'LLM call exceeded timeout', { cause: err })
  }
  if (lower.includes('rate') && lower.includes('limit')) {
    return new LLMError(LLM_ERROR_CODES.RATE_LIMIT, 'Rate limit hit', { cause: err })
  }
  if (lower.includes('429')) {
    return new LLMError(LLM_ERROR_CODES.RATE_LIMIT, 'Rate limit hit (HTTP 429)', { cause: err })
  }
  // NoObjectGeneratedError / TypeValidationError → respuesta inválida.
  if (
    lower.includes('noobjectgenerated') ||
    lower.includes('typevalidation') ||
    lower.includes('invalid')
  ) {
    return new LLMError(
      LLM_ERROR_CODES.INVALID_RESPONSE,
      'Provider returned an invalid or unparseable response',
      { cause: err },
    )
  }
  return new LLMError(LLM_ERROR_CODES.PROVIDER_ERROR, msg, { cause: err })
}

/**
 * Normaliza el `usage` del SDK a la forma `LLMUsage` del adapter.
 * El SDK 6.x expone `inputTokens`/`outputTokens`/`totalTokens`; las
 * versiones antiguas usaban `promptTokens`/`completionTokens`. Soportamos
 * ambas defensivamente.
 */
function normalizeUsage(raw: unknown): LLMUsage {
  if (!raw || typeof raw !== 'object') {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  }
  const r = raw as Record<string, unknown>
  const inputTokens =
    typeof r.inputTokens === 'number'
      ? r.inputTokens
      : typeof r.promptTokens === 'number'
        ? r.promptTokens
        : 0
  const outputTokens =
    typeof r.outputTokens === 'number'
      ? r.outputTokens
      : typeof r.completionTokens === 'number'
        ? r.completionTokens
        : 0
  const totalTokens =
    typeof r.totalTokens === 'number'
      ? r.totalTokens
      : inputTokens + outputTokens
  return { inputTokens, outputTokens, totalTokens }
}

/**
 * Sobrecarga: con schema → `T = z.infer<schema>`. Sin schema → `T = string`.
 */
export async function generateLLM<S extends ZodType>(
  opts: GenerateOptions<S> & { schema: S },
): Promise<LLMResponse<import('zod').z.infer<S>>>
export async function generateLLM(
  opts: GenerateOptions & { schema?: undefined },
): Promise<LLMResponse<string>>
export async function generateLLM<S extends ZodType>(
  opts: GenerateOptions<S>,
): Promise<LLMResponse<unknown>> {
  const client = await getLLMClient()
  if (!client) {
    throw new LLMError(
      LLM_ERROR_CODES.NO_CLIENT,
      'LLM client unavailable (disabled or no API key)',
    )
  }

  const { config, languageModel } = client
  const promptRedacted = redactPII(opts.prompt)
  const temperature = opts.temperatureOverride ?? config.temperature
  const maxOutputTokens = opts.maxTokensOverride ?? config.maxTokens

  // Timeout interno + signal externo opcional.
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(new Error('timeout')), DEFAULT_TIMEOUT_MS)
  const signal = anySignal([timeoutCtrl.signal, opts.signal])

  try {
    let output: unknown
    let usage: LLMUsage

    if (opts.schema) {
      const result = await generateObject({
        model: languageModel as LanguageModel,
        schema: opts.schema,
        prompt: promptRedacted,
        system: opts.system,
        temperature,
        maxOutputTokens,
        abortSignal: signal,
      })
      output = result.object
      usage = normalizeUsage(result.usage)
    } else {
      const result = await generateText({
        model: languageModel as LanguageModel,
        prompt: promptRedacted,
        system: opts.system,
        temperature,
        maxOutputTokens,
        abortSignal: signal,
      })
      output = result.text
      usage = normalizeUsage(result.usage)
    }

    recordLLMCall(config.model, usage)

    return {
      output,
      usage,
      cached: false,
      fallback: false,
      provider: config.provider,
      model: config.model,
    }
  } catch (err) {
    recordLLMError(config.model)
    throw mapToLLMError(err)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Atajo para casos donde sólo se necesita el `output` (sin meta).
 */
export async function generateLLMText(prompt: string, system?: string): Promise<string> {
  const r = await generateLLM({ prompt, system })
  return r.output
}
