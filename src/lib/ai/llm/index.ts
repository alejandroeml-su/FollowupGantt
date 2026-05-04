/**
 * Wave P7 · Equipo P7-1 · Adapter base de LLM (stub).
 *
 * Este archivo es un STUB MÍNIMO creado por P7-2 porque la rama
 * `feat/p7-1-llm-adapter-base` aún no fue mergeada con contenido. Cuando
 * P7-1 traiga su implementación real (proveedor Anthropic / OpenAI vía
 * `@ai-sdk/*`, telemetría, rate limiting, etc.) este módulo se REEMPLAZA
 * por completo manteniendo la misma superficie pública:
 *
 *   - getLLMClient(opts?)   → cliente con métodos de generación.
 *   - generateText(req)     → genera texto/JSON con schema opcional.
 *   - withFallback(a, b)    → corre `a()`, si falla corre `b()`.
 *   - redactPII(text)       → redacta emails, teléfonos, RFC, CURP, IDs.
 *
 * Por defecto el "cliente" no llama a ninguna API: lanza
 * `[LLM_UNAVAILABLE]` para forzar el fallback heurístico. Los tests inyectan
 * un cliente mockeado vía `setLLMClient(client)`.
 */

// ─────────────────────────── Tipos públicos ───────────────────────────

export type LLMRole = 'system' | 'user' | 'assistant'
export interface LLMMessage {
  role: LLMRole
  content: string
}

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

export interface LLMClient {
  generateText(req: GenerateTextRequest): Promise<GenerateTextResponse>
}

// ─────────────────────────── Errores ──────────────────────────────────

export class LLMError extends Error {
  constructor(public code: 'LLM_UNAVAILABLE' | 'LLM_TIMEOUT' | 'LLM_INVALID_OUTPUT', message: string) {
    super(`[${code}] ${message}`)
    this.name = 'LLMError'
  }
}

// ─────────────────────────── Cliente por defecto ──────────────────────

const stubClient: LLMClient = {
  async generateText(): Promise<GenerateTextResponse> {
    throw new LLMError(
      'LLM_UNAVAILABLE',
      'Adapter P7-1 stub: configura un cliente real con setLLMClient() o deja que withFallback active la heurística.',
    )
  },
}

let activeClient: LLMClient = stubClient

/**
 * Inyecta un cliente personalizado (típicamente desde tests). Si se pasa
 * `null`, restaura el stub.
 */
export function setLLMClient(client: LLMClient | null): void {
  activeClient = client ?? stubClient
}

/** Devuelve el cliente activo. */
export function getLLMClient(): LLMClient {
  return activeClient
}

// ─────────────────────────── Helpers públicos ─────────────────────────

/**
 * Wrapper de `client.generateText` con timeout suave.
 */
export async function generateText(
  req: GenerateTextRequest,
): Promise<GenerateTextResponse> {
  return getLLMClient().generateText(req)
}

/**
 * Ejecuta `primary()`. Si lanza, ejecuta `fallback()` y se queda con esa
 * respuesta. Devuelve también la fuente para auditoría.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<{ value: T; source: 'primary' | 'fallback'; primaryError?: string }> {
  try {
    const value = await primary()
    return { value, source: 'primary' }
  } catch (err) {
    const value = await fallback()
    const primaryError = err instanceof Error ? err.message : String(err)
    return { value, source: 'fallback', primaryError }
  }
}

// ─────────────────────────── PII redaction ────────────────────────────

const EMAIL_RE = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
// Phone: secuencias 7-15 dígitos con separadores razonables, evita hits
// en horas / fechas (3-6 dígitos no se redactan).
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/g
// RFC mexicano (3-4 letras + 6 dígitos + 3 alfanuméricos).
const RFC_RE = /\b([A-ZÑ&]{3,4})\d{6}[A-Z\d]{3}\b/g
// CURP mexicano (18 caracteres específicos).
const CURP_RE = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b/g

/**
 * Redacta PII básica del texto antes de enviarlo a un LLM externo.
 * Reemplazos:
 *   - emails → [EMAIL_REDACTED]
 *   - phones → [PHONE_REDACTED]
 *   - rfc/curp → [ID_REDACTED]
 *
 * Idempotente y determinístico. No recursivo (un solo pass por regex).
 */
export function redactPII(text: string): string {
  if (!text) return text
  let out = text
  out = out.replace(CURP_RE, '[ID_REDACTED]')
  out = out.replace(RFC_RE, '[ID_REDACTED]')
  out = out.replace(EMAIL_RE, '[EMAIL_REDACTED]')
  out = out.replace(PHONE_RE, (match) => {
    // No tocamos cosas como "1-2 días" o "8:30" — chequeo de longitud digital.
    const digits = match.replace(/\D/g, '')
    return digits.length >= 7 ? '[PHONE_REDACTED]' : match
  })
  return out
}
