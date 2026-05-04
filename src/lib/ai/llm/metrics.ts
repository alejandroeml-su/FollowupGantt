/**
 * Ola P7 · Equipo P7-1 · LLM adapter base — Métricas in-memory.
 *
 * Contador local por modelo: calls, tokens, errors, fallbacks, cache
 * hits. Sin persistencia a DB (esa decisión queda para P7-X cuando
 * Edwin defina dashboards). En tests se reinicia con `resetLLMMetrics`.
 *
 * Concurrencia: en Node single-process es seguro (mutaciones síncronas
 * de un Map). En edge runtime / serverless cada instancia tiene su
 * propio Map; eso es aceptable para un dashboard "por instancia".
 */

import type { LLMMetricsSnapshot, LLMUsage } from './types'

interface PerModelCounters {
  calls: number
  cacheHits: number
  tokensIn: number
  tokensOut: number
  errors: number
  fallbacks: number
}

const counters = new Map<string, PerModelCounters>()

function getOrInit(model: string): PerModelCounters {
  let c = counters.get(model)
  if (!c) {
    c = { calls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, errors: 0, fallbacks: 0 }
    counters.set(model, c)
  }
  return c
}

/** Registra un call exitoso (LLM efectivamente invocado). */
export function recordLLMCall(model: string, usage: LLMUsage): void {
  const c = getOrInit(model)
  c.calls += 1
  c.tokensIn += usage.inputTokens
  c.tokensOut += usage.outputTokens
}

/** Registra un cache hit (no se llamó al provider). */
export function recordLLMCacheHit(model: string): void {
  const c = getOrInit(model)
  c.cacheHits += 1
}

/** Registra un error del provider. */
export function recordLLMError(model: string): void {
  const c = getOrInit(model)
  c.errors += 1
}

/** Registra un fallback a heurística. */
export function recordLLMFallback(model: string): void {
  const c = getOrInit(model)
  c.fallbacks += 1
}

/**
 * Devuelve un snapshot inmutable de las métricas.
 * Útil para endpoints de health/diagnostics o tests.
 */
export function getLLMMetrics(): LLMMetricsSnapshot {
  const byModel: LLMMetricsSnapshot['byModel'] = {}
  const totals: LLMMetricsSnapshot['totals'] = {
    calls: 0,
    cacheHits: 0,
    tokensIn: 0,
    tokensOut: 0,
    errors: 0,
    fallbacks: 0,
  }
  for (const [model, c] of counters.entries()) {
    byModel[model] = { ...c }
    totals.calls += c.calls
    totals.cacheHits += c.cacheHits
    totals.tokensIn += c.tokensIn
    totals.tokensOut += c.tokensOut
    totals.errors += c.errors
    totals.fallbacks += c.fallbacks
  }
  return { byModel, totals }
}

/** Resetea el contador. Sólo recomendable en tests. */
export function resetLLMMetrics(): void {
  counters.clear()
}
