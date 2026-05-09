/**
 * Wave P7 · Adapter LLM unificado · Barrel oficial.
 *
 * Reemplaza el stub que P7-2 introdujo en `index.ts` antes de mergear
 * P7-1 con su implementación real (Anthropic + OpenAI + cache + métricas
 * + redacción de PII exhaustiva). El barrel publica DOS superficies en
 * el mismo paquete `@/lib/ai/llm`:
 *
 *   1) **Surface P7-1 (real)**: `generateLLM`, `generateLLMText`,
 *      `withLLMCache`, `withLLMFallback`, `getRealLLMClient`,
 *      `getLLMConfig`, `LLMError`, `LLM_ERROR_CODES`, métricas, tipos
 *      reales (`LLMResponse`, `GenerateOptions`, `FallbackResult`, etc.).
 *      Aliases unificados `generateText`/`generateObject` apuntan a
 *      `generateLLM` para los nuevos consumers (P7-3/4/5).
 *
 *   2) **Back-compat layer (stub legacy de P7-2)**: tipos y helpers que
 *      WBS sigue usando: `LLMClient`, `LLMRole`, `LLMMessage`,
 *      `GenerateTextRequest`, `GenerateTextResponse`, `setLLMClient`,
 *      `getLLMClient` (legacy sync), `withFallback` (firma 2-arg
 *      `(primary, fallback) → { value, source, primaryError }`),
 *      `redactPII` con placeholders `[EMAIL_REDACTED]`/`[PHONE_REDACTED]`
 *      /`[ID_REDACTED]` (lo que `wbs-generate.test.ts` y
 *      `wbs/prompt-templates.ts` esperan). Esto evita romper:
 *        - `src/lib/actions/wbs-generator.ts` (NO TOUCH per misión).
 *        - `tests/unit/wbs-generate.test.ts` (NO TOUCH).
 *        - `src/lib/ai/wbs/generate-wbs.ts` y `wbs/prompt-templates.ts`.
 *
 * El `redactPII` REAL de P7-1 (placeholders `[EMAIL]`/`[PHONE]`/`[RFC]`,
 * más cobertura de tokens/bearers/URLs) se accede por subpath
 * `@/lib/ai/llm/redact-pii` (los tests P7-1 lo importan así). Internamente
 * `generate.ts` lo usa para sanear prompts antes de enviarlos al SDK.
 *
 * Decisión de naming: cuando hubo colisión (`withFallback`,
 * `getLLMClient`), el LEGACY conserva el nombre canónico (porque
 * `wbs-generator.ts` es NO TOUCH y lo importa así); el real P7-1 se
 * publica con sufijo (`withLLMFallback`, `getRealLLMClient`). Los
 * nuevos consumers (P7-3/4/5) importan `generateText`/`generateObject`
 * que SÍ apuntan al adapter real (la firma legacy `{messages}` queda
 * disponible vía sobrecarga para los pocos call sites históricos).
 */

// ─────────────────────────── Real P7-1 surface ─────────────────────────

export {
  getLLMClient as getRealLLMClient,
  getLLMConfig,
  resolveProvider,
  __resetLLMClient,
  type ResolvedLLMClient,
} from './client'

export {
  generateLLM,
  generateLLMText,
} from './generate'

export {
  withFallback as withLLMFallback,
  type LlmCallable,
  type HeuristicCallable,
  type WithFallbackOptions,
} from './with-fallback'

export {
  withLLMCache,
  buildLLMCacheKey,
  buildLLMCacheTag,
  __resetLLMCacheWarmTracking,
  type WithLLMCacheOptions,
  type CacheKeyParts,
} from './with-cache'

export {
  redactPIIBatch,
  listRedactionPlaceholders,
} from './redact-pii'

export {
  LLMError,
  LLM_ERROR_CODES,
  type LLMErrorCode,
  type LLMProvider,
  type LLMConfig,
  type LLMUsage,
  type LLMResponse,
  type GenerateOptions,
  type FallbackResult,
  type LLMMetricsSnapshot,
} from './types'

export {
  recordLLMCall,
  recordLLMCacheHit,
  recordLLMError,
  recordLLMFallback,
  getLLMMetrics,
  resetLLMMetrics,
} from './metrics'

// ─────────────────────────── Aliases unificados ────────────────────────
//
// `generateLLM` cubre ambos casos (texto y objeto) según haya schema o
// no. Exportamos aliases con los nombres del SDK `ai` para legibilidad
// en los call sites de P7-3/P7-4/P7-5. Para `generateText` mantenemos
// además la sobrecarga legacy `{messages}` que el WBS usa históricamente.

import { generateLLM } from './generate'
import { LLMError as LLMErrorReal, LLM_ERROR_CODES } from './types'

/**
 * Alias de `generateLLM`. Útil cuando el caller pasa `schema` y espera
 * un objeto tipado (`generateObject({ prompt, schema })`).
 */
export const generateObject = generateLLM

// ═══════════════════════════════════════════════════════════════════════
// LEGACY back-compat layer (stub P7-2 surface)
// ═══════════════════════════════════════════════════════════════════════

/** Roles soportados por el cliente legacy (estilo chat-completions). */
export type LLMRole = 'system' | 'user' | 'assistant'

/** Mensaje del cliente legacy. */
export interface LLMMessage {
  role: LLMRole
  content: string
}

/**
 * Request del cliente legacy. El stub P7-2 lo modelaba como una
 * conversación con `system` + `messages`. Lo conservamos para que
 * `src/lib/ai/wbs/generate-wbs.ts` (que aterrizó antes que P7-1) y los
 * tests del WBS (`setLLMClient(buildClient(...))`) sigan funcionando.
 */
export interface GenerateTextRequest {
  /** Prompt de sistema (instrucciones globales). */
  system?: string
  /** Mensajes en orden cronológico. */
  messages: LLMMessage[]
  /** Hint de temperatura (0..1). El cliente real puede ignorarlo. */
  temperature?: number
  /** Modelo lógico ('fast' | 'balanced' | 'powerful'). */
  model?: 'fast' | 'balanced' | 'powerful'
  /** Tag opcional para cache; si presente, se usa como key. */
  cacheTag?: string
  /** TTL del cache en segundos. */
  cacheTTLSeconds?: number
  /** AbortSignal opcional. */
  signal?: AbortSignal
}

/** Respuesta del cliente legacy. */
export interface GenerateTextResponse {
  /** Texto crudo devuelto por el modelo. */
  text: string
  /** Aproximación del costo en tokens (input+output). 0 si no aplica. */
  tokensUsed: number
  /** Marca si el resultado vino de cache. */
  fromCache: boolean
  /** Identifica el provider que respondió (e.g. 'anthropic', 'stub'). */
  provider: string
}

/**
 * Cliente legacy estilo P7-2. Los tests del WBS inyectan implementaciones
 * de éste vía `setLLMClient` para controlar la salida del LLM sin tocar
 * el provider real.
 */
export interface LLMClient {
  generateText(req: GenerateTextRequest): Promise<GenerateTextResponse>
}

/**
 * Stub que lanza siempre. Sirve como cliente por defecto cuando no hay
 * inyección y permite a `withFallback` (legacy) caer a la heurística.
 */
const legacyStubClient: LLMClient = {
  async generateText(): Promise<GenerateTextResponse> {
    throw new LLMErrorReal(
      LLM_ERROR_CODES.NO_CLIENT,
      'Adapter legacy sin cliente inyectado: usa setLLMClient() en tests o configura un provider real.',
    )
  },
}

/**
 * Bridge automático Wave P14: traduce la API legacy `{system, messages}`
 * al adapter real P7-1 (Anthropic/OpenAI). Se construye lazy en el primer
 * request si hay credenciales en env (`ANTHROPIC_API_KEY` u `OPENAI_API_KEY`).
 * Singleton cacheado para evitar reconstruir el `LanguageModel` en cada call.
 *
 * El bridge se materializa SOLO cuando `getLegacyClient()` lo necesita y
 * `activeLegacyClient === legacyStubClient` (sin inyección manual). Los
 * tests que llaman `setLLMClient(...)` no se ven afectados.
 */
let bridgeClient: LLMClient | null | undefined = undefined
async function buildAutoBridgeClient(): Promise<LLMClient | null> {
  if (bridgeClient !== undefined) return bridgeClient
  try {
    // Imports lazy: SDK + helpers se cargan solo cuando hay llave.
    const [{ getLLMClient: getRealClient }, { generateText: sdkGenerateText }] =
      await Promise.all([
        import('./client'),
        import('ai'),
      ])
    const real = await getRealClient()
    if (!real) {
      bridgeClient = null
      return null
    }
    bridgeClient = {
      async generateText(req: GenerateTextRequest): Promise<GenerateTextResponse> {
        // Mapeo legacy {system, messages} → SDK ai {system, messages}.
        const sysParts: string[] = []
        if (req.system) sysParts.push(req.system)
        const userParts = req.messages
          .filter((m) => m.role === 'user')
          .map((m) => m.content)
        const result = await sdkGenerateText({
          model: real.languageModel,
          system: sysParts.join('\n\n') || undefined,
          prompt: userParts.join('\n\n'),
          temperature: req.temperature ?? real.config.temperature,
          abortSignal: req.signal,
        })
        // El SDK 6.x expone usage.totalTokens / inputTokens / outputTokens.
        const usage = (result.usage ?? {}) as {
          totalTokens?: number
          inputTokens?: number
          outputTokens?: number
        }
        const tokens =
          usage.totalTokens ??
          (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        return {
          text: result.text ?? '',
          tokensUsed: tokens,
          fromCache: false,
          provider: real.config.provider,
        }
      },
    }
    return bridgeClient
  } catch {
    bridgeClient = null
    return null
  }
}

/**
 * Reset del bridge para tests. NO exportado por el barrel — solo
 * accesible internamente.
 */
export function __resetLegacyBridge(): void {
  bridgeClient = undefined
}

let activeLegacyClient: LLMClient = legacyStubClient

/**
 * Inyecta un cliente legacy (típicamente desde tests). `null` restaura
 * el stub. Lo usan los tests de WBS (`setLLMClient(buildClient(...))`).
 */
export function setLLMClient(client: LLMClient | null): void {
  activeLegacyClient = client ?? legacyStubClient
}

/**
 * Devuelve el cliente legacy activo. Mantiene firma SÍNCRONA del stub
 * P7-2 para no romper código existente. El cliente real P7-1 se obtiene
 * vía `getRealLLMClient()` (async).
 */
export function getLLMClient(): LLMClient {
  return activeLegacyClient
}

/**
 * Implementación legacy de `generateText` (estilo `{system, messages}`).
 *
 * Wave P14 — si no hay cliente inyectado vía `setLLMClient(...)`, se
 * intenta construir un bridge al adapter real P7-1 (Anthropic/OpenAI)
 * usando las credenciales en env. Si el bridge falla (sin keys o
 * `LLM_ENABLED=false`), se cae al stub que lanza `LLM_NO_CLIENT` —
 * el WBS atrapará la excepción y caerá al fallback heurístico.
 *
 * Tests que inyectan cliente custom siguen funcionando porque el bridge
 * solo se activa cuando `activeLegacyClient === legacyStubClient`.
 */
async function generateTextLegacy(
  req: GenerateTextRequest,
): Promise<GenerateTextResponse> {
  if (activeLegacyClient === legacyStubClient) {
    const bridge = await buildAutoBridgeClient()
    if (bridge) return bridge.generateText(req)
  }
  return activeLegacyClient.generateText(req)
}

/**
 * `generateText` con sobrecarga unificada:
 *   - Forma legacy `{messages}` → delega en el cliente legacy inyectado.
 *   - Forma P7-1 `{prompt}` → delega en `generateLLM` real.
 *
 * Permite que `generate-wbs.ts` (call sites históricos `{messages}`) y
 * los nuevos consumers (P7-3/4/5 con `{prompt, schema}`) compartan el
 * mismo nombre.
 */
export function generateText(
  req: GenerateTextRequest,
): Promise<GenerateTextResponse>
export function generateText(
  req: Parameters<typeof generateLLM>[0],
): ReturnType<typeof generateLLM>
export function generateText(req: unknown): unknown {
  if (
    req != null &&
    typeof req === 'object' &&
    'messages' in (req as Record<string, unknown>) &&
    Array.isArray((req as { messages?: unknown }).messages)
  ) {
    return generateTextLegacy(req as GenerateTextRequest)
  }
  return generateLLM(req as Parameters<typeof generateLLM>[0])
}

// ─────────────────────────── Legacy withFallback ───────────────────────

/**
 * Resultado de la firma legacy `withFallback(primary, fallback)`. Es lo
 * que `wbs-generator.ts` (NO TOUCH) consume como
 * `{ value, source, primaryError }`. La firma rica de P7-1 se publica
 * como `withLLMFallback`.
 */
export interface LegacyFallbackResult<T> {
  value: T
  source: 'primary' | 'fallback'
  primaryError?: string
}

/**
 * Ejecuta `primary()`. Si lanza, ejecuta `fallback()` y se queda con esa
 * respuesta. Devuelve también la fuente para auditoría. Esta es la
 * firma 2-arg del stub P7-2 — la conservamos como nombre canónico
 * `withFallback` por compatibilidad con `wbs-generator.ts`.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<LegacyFallbackResult<T>> {
  try {
    const value = await primary()
    return { value, source: 'primary' }
  } catch (err) {
    const value = await fallback()
    const primaryError = err instanceof Error ? err.message : String(err)
    return { value, source: 'fallback', primaryError }
  }
}

// ─────────────────────────── Legacy redactPII ──────────────────────────
//
// La versión REAL de P7-1 vive en `./redact-pii` y usa placeholders
// `[EMAIL]`/`[PHONE]`/`[RFC]`/`[TOKEN]`/etc. Ese módulo se importa por
// subpath (`@/lib/ai/llm/redact-pii`) en los tests P7-1 y dentro de
// `generate.ts`. Pero `wbs/prompt-templates.ts` y
// `wbs-generate.test.ts` (NO TOUCH) esperan los placeholders del stub
// P7-2: `[EMAIL_REDACTED]`/`[PHONE_REDACTED]`/`[ID_REDACTED]`. Para no
// romperlos publicamos en el barrel esta versión legacy alineada con
// esos placeholders. Así `wbs/prompt-templates.ts` sigue funcionando
// sin cambios y los tests de P7-1 (subpath) tampoco se afectan.

const LEGACY_EMAIL_RE = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
// Phone: secuencias 7-15 dígitos con separadores razonables, evita hits
// en horas / fechas (3-6 dígitos no se redactan).
const LEGACY_PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/g
// RFC mexicano (3-4 letras + 6 dígitos + 3 alfanuméricos).
const LEGACY_RFC_RE = /\b([A-ZÑ&]{3,4})\d{6}[A-Z\d]{3}\b/g
// CURP mexicano (18 caracteres específicos).
const LEGACY_CURP_RE = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b/g

/**
 * Redacta PII básica del texto antes de enviarlo a un LLM externo.
 * Reemplazos:
 *   - emails → [EMAIL_REDACTED]
 *   - phones → [PHONE_REDACTED]
 *   - rfc/curp → [ID_REDACTED]
 *
 * Versión legacy (placeholders del stub P7-2). Mantenida para no romper
 * `wbs/prompt-templates.ts` ni `wbs-generate.test.ts`. Los nuevos
 * consumers que prefieran la cobertura amplia (tokens, bearers, URLs)
 * deben importar `redactPII` desde `@/lib/ai/llm/redact-pii`.
 */
export function redactPII(text: string): string {
  if (!text) return text
  let out = text
  out = out.replace(LEGACY_CURP_RE, '[ID_REDACTED]')
  out = out.replace(LEGACY_RFC_RE, '[ID_REDACTED]')
  out = out.replace(LEGACY_EMAIL_RE, '[EMAIL_REDACTED]')
  out = out.replace(LEGACY_PHONE_RE, (match) => {
    // No tocamos cosas como "1-2 días" o "8:30" — chequeo de longitud digital.
    const digits = match.replace(/\D/g, '')
    return digits.length >= 7 ? '[PHONE_REDACTED]' : match
  })
  return out
}
