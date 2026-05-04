/**
 * Wave P7 · Equipo P7-2 · WBS Generator — Generación con LLM real.
 *
 * Llama al adapter P7-1 (`generateText`) con el system prompt + brief
 * redactado. Valida el output contra `wbsSchema`, sanitiza dependencias
 * (remueve referencias inválidas + rompe ciclos) y limita profundidad.
 *
 * El parsing es defensivo: el LLM puede insertar fences markdown a pesar
 * del system prompt, así que extraemos el primer JSON balanceado del
 * texto antes de pasarlo a `JSON.parse`.
 */

import { generateText, type GenerateTextRequest } from '@/lib/ai/llm'
import {
  wbsSchema,
  assertDepth,
  sanitizeDependencies,
  breakCycles,
  type WBSGenerated,
} from './wbs-schema'
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  hashBrief,
  type BuildPromptOptions,
} from './prompt-templates'

export interface GenerateLLMOptions extends BuildPromptOptions {
  /** Hint de modelo lógico para el adapter. */
  model?: GenerateTextRequest['model']
  /** Hint de temperatura. */
  temperature?: number
  /** AbortSignal opcional. */
  signal?: AbortSignal
}

export interface GenerateLLMResult {
  wbs: WBSGenerated
  warnings: string[]
  tokensUsed: number
  fromCache: boolean
  provider: string
}

/**
 * Pide al LLM un WBS estructurado. Lanza Error tipado en caso de fallo:
 *   - `[LLM_FAILED]` si el adapter no devuelve texto.
 *   - `[INVALID_OUTPUT]` si el JSON no parsea o no cumple schema.
 */
export async function generateWBSFromBriefLLM(
  brief: string,
  options: GenerateLLMOptions = {},
): Promise<GenerateLLMResult> {
  if (!brief || brief.trim().length < 10) {
    throw new Error('[INVALID_INPUT] Brief debe tener al menos 10 caracteres')
  }

  const userPrompt = buildUserPrompt(brief, options)
  const cacheTag = `wbs:${hashBrief(`${userPrompt}|${options.model ?? 'balanced'}`)}`

  const response = await generateText({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    model: options.model ?? 'balanced',
    temperature: options.temperature ?? 0.3,
    cacheTag,
    cacheTTLSeconds: 3600,
    signal: options.signal,
  })

  if (!response.text || response.text.trim().length === 0) {
    throw new Error('[LLM_FAILED] El adapter no devolvió texto')
  }

  const json = extractFirstJSON(response.text)
  if (!json) {
    throw new Error('[INVALID_OUTPUT] No se encontró JSON balanceado en la respuesta del LLM')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new Error(
      `[INVALID_OUTPUT] JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const result = wbsSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(`[INVALID_OUTPUT] WBS no cumple schema: ${issues}`)
  }

  const wbs = result.data

  // Saneamos dependencias y profundidad. Las warnings se acumulan para que
  // el caller pueda mostrarlas al usuario.
  const warnings: string[] = []
  warnings.push(...sanitizeDependencies(wbs).warnings)
  warnings.push(...breakCycles(wbs).warnings)
  assertDepth(wbs)

  // Override del projectName si se forzó por opción.
  if (options.projectName) {
    wbs.projectName = options.projectName
  }

  return {
    wbs,
    warnings,
    tokensUsed: response.tokensUsed,
    fromCache: response.fromCache,
    provider: response.provider,
  }
}

// ─────────────────────────── JSON extractor ───────────────────────────

/**
 * Extrae el primer objeto JSON balanceado del texto. Útil cuando el LLM
 * envuelve la respuesta en fences markdown a pesar del system prompt.
 *
 * Algoritmo: encuentra el primer `{`, recorre carácter a carácter
 * contando llaves balanceadas (ignorando llaves dentro de strings con
 * escape), retorna el slice cuando el balance vuelve a cero. Si no se
 * cierra correctamente, retorna `null`.
 */
export function extractFirstJSON(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
