/**
 * Ola P7 · Equipo P7-1 · LLM adapter base — Tipos compartidos.
 *
 * Estos tipos son la API pública del adapter. Las features P7-2/3/4/5
 * (categorización LLM, predicción de riesgo LLM, sugerencia de acciones
 * LLM, resúmenes de proyecto) los consumen vía `generate.ts` +
 * `with-fallback.ts` + `with-cache.ts`.
 *
 * Diseño:
 *   - `LLMProvider` incluye `'disabled'` para representar el estado en
 *     el que el cliente devuelve `null` (sin API keys o `LLM_ENABLED=false`).
 *     Esto permite ramas explícitas en `withFallback`.
 *   - `LLMResponse<T>` siempre acarrea `usage` y `cached`/`fallback` flags
 *     para alimentar `metrics.ts` y la UI ("Generado por LLM" vs
 *     "Cálculo determinista").
 *   - `GenerateOptions` toma un `schema` opcional (zod). Si está
 *     presente, usamos `generateObject`; si no, `generateText`.
 *
 * Sin imports tipados de Zod aquí — usamos `unknown` + un constraint
 * laxo en `generate.ts` para que el adapter no obligue a importar Zod
 * en módulos que sólo consumen tipos.
 */

import type { ZodType } from 'zod'

/** Identifica el proveedor activo. `'disabled'` cuando no hay cliente. */
export type LLMProvider = 'anthropic' | 'openai' | 'disabled'

/**
 * Configuración resuelta del adapter (post-merge env + defaults).
 * Inmutable a lo largo de la vida del proceso (singleton en `client.ts`).
 */
export interface LLMConfig {
  provider: LLMProvider
  /** Modelo concreto. Vacío si `provider === 'disabled'`. */
  model: string
  /** Tope de tokens de salida. Default 2048. */
  maxTokens: number
  /** Temperatura 0..1. Default 0.2 (favorece respuestas estructuradas). */
  temperature: number
  /** Hard switch global. Si `false`, el adapter SIEMPRE devuelve `null`. */
  enabled: boolean
}

/** Métrica de uso de tokens devuelta por el provider. */
export interface LLMUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * Respuesta tipada del adapter. `T = string` para `generateText`,
 * `T = z.infer<schema>` cuando hay schema.
 */
export interface LLMResponse<T> {
  output: T
  usage: LLMUsage
  /** `true` si la respuesta vino del cache de `unstable_cache`. */
  cached: boolean
  /** `true` si esta respuesta es un fallback heurístico (no LLM). */
  fallback: boolean
  /** Provider que sirvió la respuesta (útil para auditoría). */
  provider: LLMProvider
  /** Modelo concreto. */
  model: string
}

/**
 * Opciones para `generateLLM` (texto u objeto).
 *
 * - `prompt`: usuario. Pasa por `redactPII` antes de enviar.
 * - `system`: instrucciones de sistema. NO se redacta (asumimos no PII).
 * - `schema`: zod. Si presente → `generateObject` con output tipado.
 * - `cacheKey`/`cacheTTL`: si presentes, se cachea con `withLLMCache`.
 *
 * `unknown` para schema porque no queremos forzar `any` ni perder type
 * safety en consumidores. El generic en `generate.ts` se encarga.
 */
export interface GenerateOptions<TSchema extends ZodType = ZodType> {
  prompt: string
  system?: string
  schema?: TSchema
  /** Identificador estable para construir la cache key. */
  cacheKey?: string
  /** TTL en segundos. Default 3600 (1h). */
  cacheTTL?: number
  /** Override del modelo del singleton (raramente útil). */
  modelOverride?: string
  /** Override de temperatura (ej. 0 para determinista). */
  temperatureOverride?: number
  /** Override de maxTokens. */
  maxTokensOverride?: number
  /** AbortSignal externo (encadenable con el timeout interno). */
  signal?: AbortSignal
}

/**
 * Códigos de error del adapter. Se mapean en `generate.ts` desde el
 * SDK `ai`. Se exportan como const + type literal para usarlos en
 * `instanceof`-style checks sin perder exhaustividad.
 */
export const LLM_ERROR_CODES = {
  TIMEOUT: 'LLM_TIMEOUT',
  RATE_LIMIT: 'LLM_RATE_LIMIT',
  INVALID_RESPONSE: 'LLM_INVALID_RESPONSE',
  NO_CLIENT: 'LLM_NO_CLIENT',
  PROVIDER_ERROR: 'LLM_PROVIDER_ERROR',
} as const

export type LLMErrorCode = (typeof LLM_ERROR_CODES)[keyof typeof LLM_ERROR_CODES]

/**
 * Error tipado del adapter. Los consumidores hacen
 * `if (err instanceof LLMError && err.code === 'LLM_TIMEOUT')`.
 *
 * Mantenemos `cause` (Error.cause de ES2022) para preservar el stack
 * trace del provider sin colisiones de nombres.
 */
export class LLMError extends Error {
  public readonly code: LLMErrorCode

  constructor(code: LLMErrorCode, message: string, options?: { cause?: unknown }) {
    super(`[${code}] ${message}`, options)
    this.name = 'LLMError'
    this.code = code
  }
}

/**
 * Resultado de `withFallback`. `source` indica si la respuesta vino
 * del LLM o del fallback heurístico determinista. `confidence` 0..1
 * combina la confianza reportada por el modelo (si la hay) con un
 * piso/techo razonable.
 */
export interface FallbackResult<T> {
  output: T
  source: 'llm' | 'heuristic'
  confidence: number
  /** Razón legible (útil para UI o logs). */
  reason?: string
  /** Provider efectivo. `'disabled'` cuando viene de heurística. */
  provider: LLMProvider
}

/** Snapshot de las métricas in-memory. */
export interface LLMMetricsSnapshot {
  /** Por modelo, contador de calls/tokens/errors. */
  byModel: Record<
    string,
    {
      calls: number
      cacheHits: number
      tokensIn: number
      tokensOut: number
      errors: number
      fallbacks: number
    }
  >
  totals: {
    calls: number
    cacheHits: number
    tokensIn: number
    tokensOut: number
    errors: number
    fallbacks: number
  }
}
