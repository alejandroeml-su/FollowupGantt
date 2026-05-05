/**
 * Ola P7 · Equipo P7-3 · Resúmenes ejecutivos LLM
 *
 * Prompts compartidos + thin LLM adapter con `withFallback`.
 *
 * Decisiones:
 *   - El adapter unificado vive en `@/lib/ai/llm` (P7-1). Aquí
 *     mantenemos un wrapper `callLLM(args) -> Promise<string>` que
 *     enruta a `generateLLMText` y devuelve sólo el texto. Los
 *     consumers del módulo (status-narrative, executive-briefing,
 *     baseline-diff-summary, risks-narrative) siguen importando
 *     `callLLM` y `withFallback` desde aquí — back-compat post Wave
 *     C-DEBT-3.
 *   - `injectLLMForTests` permite a los tests sustituir el call real
 *     por una respuesta canned sin tocar `vi.mock('@/lib/ai/llm', ...)`.
 *   - El fallback heurístico recibe los mismos datos y devuelve markdown
 *     estático determinístico. Marcamos `source` ('llm' | 'heuristic')
 *     en el resultado para que la UI lo refleje.
 *   - **NUNCA inventamos datos**: el system prompt prohíbe explícitamente
 *     extrapolar más allá de los datos enviados.
 *   - Caché: cada summary action usa `unstable_cache` con su tag
 *     `summary:<kind>:<scope>` y TTL 30min (regenerable con bypass).
 */

import 'server-only'
import { z } from 'zod'

import {
  generateLLMText,
  getLLMConfig,
  LLMError,
  LLM_ERROR_CODES,
} from '@/lib/ai/llm'

// ─────────────────────────── System prompt ────────────────────────────

/**
 * System prompt compartido por todos los summarizers. Tono ejecutivo,
 * conciso, prohíbe alucinar. Si el LLM detecta que los datos son
 * insuficientes, debe decirlo en lugar de inventar.
 */
export const SYSTEM_PROMPT_PMO = `Eres analista de PMO senior de la Unidad de Transformación Digital. Resumes datos del portafolio en lenguaje claro y accionable, en español neutro.

Reglas estrictas:
1. NUNCA inventas datos: si los datos enviados son insuficientes, dilo explícitamente.
2. Cita métricas tal como vienen en el JSON; no extrapoles.
3. Tono: ejecutivo, conciso, accionable. Evita jerga técnica innecesaria.
4. Estructura tu respuesta en markdown válido.
5. Si detectas datos contradictorios, los señalas como "punto de aclaración" en lugar de elegir uno.

Devuelves SIEMPRE markdown — no JSON, no XML.`

// ─────────────────────────── Constantes ───────────────────────────────

/** TTL del cache de summaries en segundos (30 min). */
export const SUMMARY_CACHE_TTL_SECONDS = 30 * 60

/** Modelo por defecto si LLM_ENABLED. Configurable por env. */
export const DEFAULT_LLM_MODEL =
  process.env.LLM_MODEL ?? 'claude-3-5-sonnet-20241022'

/** Umbral de detección de datos insuficientes para evitar llamar al LLM en vano. */
export const MIN_TASKS_FOR_LLM = 1

// ─────────────────────────── Schema de salida común ───────────────────

/**
 * Shape común de todos los summaries. Las páginas y componentes consumen
 * este tipo (con `markdown` listo para renderizar) sin importar si el
 * origen fue LLM o heurística.
 */
export const NarrativeSchema = z.object({
  headline: z.string().min(1),
  markdown: z.string().min(1),
  keyPoints: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  source: z.enum(['llm', 'heuristic']),
  generatedAt: z.string().datetime(),
})

export type Narrative = z.infer<typeof NarrativeSchema>

// ─────────────────────────── Adapter LLM ──────────────────────────────

/**
 * ¿Está activo el LLM? Wave C-DEBT-3: delegamos en `getLLMConfig()` del
 * adapter unificado P7-1, que ya consolida `LLM_ENABLED` + presencia de
 * API key. Mantenemos la función exportada para back-compat con
 * cualquier consumer histórico que la importe.
 */
export function isLLMEnabled(): boolean {
  const cfg = getLLMConfig()
  return cfg.enabled && cfg.provider !== 'disabled'
}

/**
 * Argumentos del wrapper `callLLM` — la firma legacy de los summaries
 * (`systemPrompt` + `userMessage` + `maxTokens` opcional). Internamente
 * los traducimos a la forma `{ prompt, system, maxTokensOverride }`
 * del adapter P7-1.
 */
export type LLMCallArgs = {
  systemPrompt: string
  userMessage: string
  /** Mostly hint; el adapter lo respeta best-effort. */
  maxTokens?: number
}

export type LLMCallFn = (args: LLMCallArgs) => Promise<string>

let injected: LLMCallFn | null = null

/**
 * Permite inyectar un cliente LLM mockeado en tests sin tocar env vars.
 * En producción no se usa. Mantiene el contrato existente para los
 * tests `summaries-status`, `summaries-briefing`, `summaries-baseline-diff`.
 */
export function injectLLMForTests(fn: LLMCallFn | null): void {
  injected = fn
}

/**
 * Llamada al LLM. Wave C-DEBT-3: bridge a `generateLLMText` del adapter
 * unificado P7-1. El error tipado `LLMError` de P7-1 se mapea a un
 * Error con prefijo `[LLM_*]` para preservar el formato que
 * `withFallback` (abajo) parsea para sus warnings.
 *
 * Contrato: lanza si el LLM falla o si está deshabilitado. Quien llame
 * envuelve en `withFallback`.
 */
export async function callLLM(args: LLMCallArgs): Promise<string> {
  if (injected) return injected(args)
  if (!isLLMEnabled()) {
    throw new LLMError(
      LLM_ERROR_CODES.NO_CLIENT,
      'LLM no habilitado o API keys faltan',
    )
  }
  return generateLLMText(args.userMessage, args.systemPrompt)
}

// ─────────────────────────── withFallback ─────────────────────────────

/**
 * Ejecuta `primary` (LLM) y, si falla por cualquier motivo (no enabled,
 * timeout, response inválida), recurre a `fallback` (heurística). El
 * resultado siempre lleva `source` correcto.
 *
 * Garantías:
 *   - Nunca lanza si `fallback` no lanza (la heurística debe ser pura).
 *   - El error del primary se loggea con `console.warn` con prefijo
 *     `[summaries]` para diagnóstico, pero NO se filtra al cliente.
 */
export async function withFallback<T extends { source: 'llm' | 'heuristic' }>(
  primary: () => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  try {
    const result = await primary()
    return result
  } catch (err) {
    const code =
      err instanceof Error && err.message.startsWith('[')
        ? err.message.split(']')[0].slice(1)
        : 'UNKNOWN'
    console.warn(`[summaries] LLM fallo (${code}); usando heurística`)
    return await fallback()
  }
}

// ─────────────────────────── Helper: mensaje user ─────────────────────

/**
 * Serializa el dato como JSON compacto y lo envuelve con la instrucción
 * específica de cada summary. Centralizado para mantener el formato
 * consistente y testeable.
 */
export function buildUserMessage(args: {
  instruction: string
  data: unknown
  outputHint?: string
}): string {
  const dataJson = JSON.stringify(args.data, null, 2)
  const lines = [
    args.instruction,
    '',
    'Datos disponibles (JSON):',
    '```json',
    dataJson,
    '```',
  ]
  if (args.outputHint) {
    lines.push('', args.outputHint)
  }
  return lines.join('\n')
}

// ─────────────────────────── Parsers tolerantes ───────────────────────

/**
 * El LLM devuelve markdown libre. Para validar que cumple lo mínimo
 * (headline + cuerpo) extraemos el primer `#` o la primera línea no vacía.
 * Si no hay nada usable, lanzamos para que `withFallback` recurra al
 * heurístico.
 */
export function parseLLMMarkdown(raw: string): {
  headline: string
  markdown: string
  keyPoints: string[]
  recommendations: string[]
} {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('[LLM_EMPTY_OUTPUT] respuesta vacía')
  }
  const lines = trimmed.split('\n')
  let headline = ''
  for (const line of lines) {
    const m = /^#{1,3}\s+(.+)$/.exec(line.trim())
    if (m) {
      headline = m[1].trim()
      break
    }
  }
  if (!headline) {
    headline = lines.find((l) => l.trim().length > 0)?.trim() ?? 'Resumen'
    headline = headline.replace(/^#+\s*/, '').slice(0, 120)
  }

  // Extraemos bullets como keyPoints/recommendations heurísticamente:
  // - "- " bullets antes de "## Recomendaciones" → keyPoints
  // - bullets bajo "## Recomendaciones" → recommendations
  const keyPoints: string[] = []
  const recommendations: string[] = []
  let inRecommendations = false
  for (const line of lines) {
    const t = line.trim()
    if (/^#+\s*recomendaciones/i.test(t)) {
      inRecommendations = true
      continue
    }
    if (/^#+\s/.test(t) && inRecommendations) {
      inRecommendations = false
    }
    const bullet = /^[-*]\s+(.+)$/.exec(t)
    if (bullet) {
      const item = bullet[1].trim()
      if (inRecommendations) recommendations.push(item)
      else keyPoints.push(item)
    }
  }

  return {
    headline,
    markdown: trimmed,
    keyPoints: keyPoints.slice(0, 8),
    recommendations: recommendations.slice(0, 8),
  }
}
