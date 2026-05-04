/**
 * Ola P7 · Equipo P7-1 · LLM adapter base — Cliente singleton.
 *
 * `getLLMClient()` resuelve la configuración a partir de variables de
 * entorno y devuelve un `{ provider, model, languageModel }` o `null`
 * cuando no hay credenciales / `LLM_ENABLED=false`. El SDK `ai` espera
 * un `LanguageModel` para `generateText`/`generateObject`, así que aquí
 * lo pre-instanciamos.
 *
 * Estrategia:
 *   1. Si `LLM_ENABLED=false`, devolver null (heurística forzada).
 *   2. Si `LLM_PROVIDER` es explícito, intentar ese; si falta su API
 *      key → log + null.
 *   3. Default: Anthropic si `ANTHROPIC_API_KEY` presente.
 *   4. Fallback: OpenAI si `OPENAI_API_KEY` presente.
 *   5. Si ninguno → null.
 *
 * Singleton: cacheamos el cliente entre llamadas para evitar re-crear
 * el provider y re-leer env en cada call. Reset disponible para tests
 * vía `__resetLLMClient`.
 *
 * Lectura lazy: el módulo `@ai-sdk/anthropic`/`@ai-sdk/openai` se
 * importa dinámicamente sólo si la API key está presente. Esto evita
 * el costo de bundle en deployments donde el LLM esté deshabilitado.
 */

import type { LanguageModel } from 'ai'

import type { LLMConfig, LLMProvider } from './types'

const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const DEFAULT_MAX_TOKENS = 2048
const DEFAULT_TEMPERATURE = 0.2

export interface ResolvedLLMClient {
  config: LLMConfig
  /** Modelo del SDK `ai` listo para `generateText`/`generateObject`. */
  languageModel: LanguageModel
}

let cached: ResolvedLLMClient | null | undefined = undefined

/**
 * Lee env var soportando override con default. Trim de strings.
 */
function envStr(key: string, fallback?: string): string | undefined {
  const v = process.env[key]
  if (v == null) return fallback
  const trimmed = v.trim()
  return trimmed === '' ? fallback : trimmed
}

function envBool(key: string, fallback: boolean): boolean {
  const v = envStr(key)
  if (v === undefined) return fallback
  return v.toLowerCase() === 'true' || v === '1'
}

function envNum(key: string, fallback: number): number {
  const v = envStr(key)
  if (v === undefined) return fallback
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

interface ResolveResult {
  provider: LLMProvider
  apiKeyPresent: boolean
}

/**
 * Decide qué provider usar dado el env. Pure function (testeable).
 */
export function resolveProvider(env: NodeJS.ProcessEnv): ResolveResult {
  const enabled = (env.LLM_ENABLED ?? 'true').trim().toLowerCase() !== 'false'
  if (!enabled) return { provider: 'disabled', apiKeyPresent: false }

  const explicit = env.LLM_PROVIDER?.trim().toLowerCase()
  const hasAnthropic = !!env.ANTHROPIC_API_KEY?.trim()
  const hasOpenai = !!env.OPENAI_API_KEY?.trim()

  if (explicit === 'anthropic') {
    return { provider: hasAnthropic ? 'anthropic' : 'disabled', apiKeyPresent: hasAnthropic }
  }
  if (explicit === 'openai') {
    return { provider: hasOpenai ? 'openai' : 'disabled', apiKeyPresent: hasOpenai }
  }
  if (explicit === 'disabled') {
    return { provider: 'disabled', apiKeyPresent: false }
  }

  // Auto-detect: Anthropic primario, OpenAI fallback.
  if (hasAnthropic) return { provider: 'anthropic', apiKeyPresent: true }
  if (hasOpenai) return { provider: 'openai', apiKeyPresent: true }
  return { provider: 'disabled', apiKeyPresent: false }
}

/**
 * Construye el `LanguageModel` del SDK. Imports dinámicos para evitar
 * costo de bundle si no se usa.
 */
async function buildLanguageModel(
  provider: 'anthropic' | 'openai',
  model: string,
): Promise<LanguageModel> {
  if (provider === 'anthropic') {
    const mod = await import('@ai-sdk/anthropic')
    return mod.anthropic(model)
  }
  const mod = await import('@ai-sdk/openai')
  return mod.openai(model)
}

/**
 * Devuelve el cliente singleton (o null). `await getLLMClient()`.
 *
 * Cuando devuelve null:
 *   - `LLM_ENABLED=false`
 *   - Provider explícito sin API key
 *   - Sin ningún API key disponible
 *
 * En esos casos, los consumidores deben caer al fallback heurístico
 * vía `withFallback`.
 */
export async function getLLMClient(): Promise<ResolvedLLMClient | null> {
  if (cached !== undefined) return cached

  const resolved = resolveProvider(process.env)
  if (resolved.provider === 'disabled') {
    cached = null
    return null
  }

  const provider = resolved.provider
  const defaultModel =
    provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL
  const model = envStr('LLM_MODEL', defaultModel)!
  const maxTokens = envNum('LLM_MAX_TOKENS', DEFAULT_MAX_TOKENS)
  const temperature = envNum('LLM_TEMPERATURE', DEFAULT_TEMPERATURE)
  const enabled = envBool('LLM_ENABLED', true)

  const languageModel = await buildLanguageModel(provider, model)

  cached = {
    config: { provider, model, maxTokens, temperature, enabled },
    languageModel,
  }
  return cached
}

/**
 * Devuelve la config sin crear el `LanguageModel`. Útil para
 * decisiones rápidas (UI, métricas) sin pagar el dynamic import.
 */
export function getLLMConfig(): LLMConfig {
  if (cached) return cached.config
  const resolved = resolveProvider(process.env)
  return {
    provider: resolved.provider,
    model:
      resolved.provider === 'anthropic'
        ? envStr('LLM_MODEL', DEFAULT_ANTHROPIC_MODEL)!
        : resolved.provider === 'openai'
          ? envStr('LLM_MODEL', DEFAULT_OPENAI_MODEL)!
          : '',
    maxTokens: envNum('LLM_MAX_TOKENS', DEFAULT_MAX_TOKENS),
    temperature: envNum('LLM_TEMPERATURE', DEFAULT_TEMPERATURE),
    enabled: envBool('LLM_ENABLED', true),
  }
}

/**
 * Reset del singleton. Sólo para tests (o un eventual hot-reload de
 * env vars). NO exportado del barrel.
 */
export function __resetLLMClient(): void {
  cached = undefined
}
