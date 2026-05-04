/**
 * Ola P7 · Equipo P7-1 · LLM adapter base — HOF `withFallback`.
 *
 * Patrón estándar para todas las features P7-2/3/4/5:
 *   - Intenta `llmFn` (que puede llamar a `generateLLM`).
 *   - Si lanza (cualquier `LLMError` o error inesperado) o el cliente
 *     está deshabilitado → invoca `heuristicFn` y devuelve su resultado.
 *   - Loggea el fallback con Sentry (breadcrumb + capture warning) y
 *     registra la métrica.
 *
 * Devuelve `FallbackResult<T>` con `source`, `confidence` y `provider`,
 * lo que permite a la UI mostrar la procedencia ("Calculado por IA"
 * vs "Cálculo determinista").
 *
 * Sin `any`: el generic `T` es la forma común a las dos funciones. Si
 * el LLM y la heurística devuelven shapes ligeramente distintas, el
 * llamador debe normalizar previamente.
 */

import * as Sentry from '@sentry/nextjs'

import { getLLMConfig } from './client'
import { recordLLMFallback } from './metrics'
import {
  LLMError,
  LLM_ERROR_CODES,
  type FallbackResult,
  type LLMProvider,
} from './types'

export interface WithFallbackOptions {
  /** Nombre lógico de la operación (ej. 'categorize-task'). Para logs. */
  name: string
  /**
   * Confianza por defecto del LLM cuando no la reporta. Default 0.85
   * (asumimos que si LLM respondió sin throw es razonablemente confiable).
   */
  defaultLlmConfidence?: number
  /**
   * Confianza por defecto de la heurística. Default 0.6 (un piso
   * conservador; las heurísticas P5-4 ya devuelven su propia confianza).
   */
  defaultHeuristicConfidence?: number
  /** Si `true`, no reporta a Sentry el fallback. Útil en hot paths. */
  silent?: boolean
}

export interface LlmCallable<T> {
  (): Promise<{ output: T; confidence?: number; provider?: LLMProvider; reason?: string }>
}

export interface HeuristicCallable<T> {
  (reason?: string): Promise<{ output: T; confidence?: number; reason?: string }> | {
    output: T
    confidence?: number
    reason?: string
  }
}

/**
 * Intenta `llmFn`; si falla o el LLM está deshabilitado, ejecuta
 * `heuristicFn`. Siempre devuelve un `FallbackResult<T>`.
 */
export async function withFallback<T>(
  llmFn: LlmCallable<T>,
  heuristicFn: HeuristicCallable<T>,
  options: WithFallbackOptions,
): Promise<FallbackResult<T>> {
  const cfg = getLLMConfig()

  // Short-circuit: si LLM está disabled, no intentamos.
  if (!cfg.enabled || cfg.provider === 'disabled') {
    const h = await heuristicFn('llm-disabled')
    recordLLMFallback(cfg.model || 'disabled')
    return {
      output: h.output,
      source: 'heuristic',
      confidence: h.confidence ?? options.defaultHeuristicConfidence ?? 0.6,
      reason: h.reason ?? 'LLM disabled',
      provider: 'disabled',
    }
  }

  try {
    const r = await llmFn()
    return {
      output: r.output,
      source: 'llm',
      confidence: r.confidence ?? options.defaultLlmConfidence ?? 0.85,
      reason: r.reason,
      provider: r.provider ?? cfg.provider,
    }
  } catch (err) {
    const code = err instanceof LLMError ? err.code : LLM_ERROR_CODES.PROVIDER_ERROR
    const reason = `llm-error:${code}`

    if (!options.silent) {
      try {
        Sentry.addBreadcrumb({
          category: 'llm.fallback',
          message: `${options.name} fell back to heuristic (${code})`,
          level: 'warning',
          data: { provider: cfg.provider, model: cfg.model, code },
        })
        // Captura como warning (no error) — el fallback es comportamiento
        // esperado del adapter, no una falla del producto.
        Sentry.captureMessage(`LLM fallback: ${options.name} (${code})`, 'warning')
      } catch {
        // Sentry no configurado en tests / dev — silencioso.
      }
    }

    recordLLMFallback(cfg.model)

    const h = await heuristicFn(reason)
    return {
      output: h.output,
      source: 'heuristic',
      confidence: h.confidence ?? options.defaultHeuristicConfidence ?? 0.6,
      reason: h.reason ?? reason,
      provider: 'disabled',
    }
  }
}
