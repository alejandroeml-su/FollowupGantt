/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — "Sugerir tags".
 *
 * Extrae 1-5 tags relevantes del contenido de una task. Prefiere
 * reutilizar tags existentes en el proyecto (top 30 por uso) y
 * solo introduce nuevos cuando son claramente más relevantes.
 *
 * Heurística de fallback: combina los `suggestedTags` (hashtags `#tag`)
 * de `categorizeTask` y la categoría detectada como tag-base.
 */

import {
  SuggestTagsSchema,
  type SuggestTagsResult,
  type RefinementResultEnvelope,
} from './schemas'
import {
  callLLMObject,
  buildSuggestTagsPrompt,
  SYSTEM_SUGGEST_TAGS,
  LLMDisabledError,
  LLMCallError,
} from './prompts'
import { categorizeTask } from '@/lib/ai/categorize'

export interface SuggestTagsInput {
  title: string
  description?: string | null
  /** Top N tags más usados en el proyecto, ordenados por uso desc. */
  existingTags: string[]
}

const TAG_CHAR_RE = /^[a-zA-Z0-9_-]+$/

function sanitizeTag(raw: string): string | null {
  const t = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32)
  if (t.length < 2) return null
  if (!TAG_CHAR_RE.test(t)) return null
  return t
}

export function suggestTagsHeuristic(input: SuggestTagsInput): SuggestTagsResult {
  const cat = categorizeTask(input.title, input.description ?? null)
  const existing = new Set(input.existingTags.map((t) => t.toLowerCase()))
  const result: SuggestTagsResult['tags'] = []
  const seen = new Set<string>()

  // 1) Hashtags explícitos detectados por categorize.ts.
  for (const t of cat.suggestedTags) {
    const safe = sanitizeTag(t)
    if (!safe || seen.has(safe)) continue
    seen.add(safe)
    result.push({ tag: safe, reused: existing.has(safe) })
  }

  // 2) Categoría detectada como tag-base.
  if (cat.suggestedCategory !== 'OTHER') {
    const catTag = sanitizeTag(cat.suggestedCategory.toLowerCase())
    if (catTag && !seen.has(catTag)) {
      seen.add(catTag)
      result.push({ tag: catTag, reused: existing.has(catTag) })
    }
  }

  // 3) Si tenemos pocos y hay tags existentes que aparecen en el texto, súmalos.
  if (result.length < 3 && input.existingTags.length > 0) {
    const haystack = `${input.title} ${input.description ?? ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    for (const existingTag of input.existingTags) {
      const lower = existingTag.toLowerCase()
      if (seen.has(lower)) continue
      if (haystack.includes(lower)) {
        const safe = sanitizeTag(lower)
        if (safe) {
          seen.add(safe)
          result.push({ tag: safe, reused: true })
        }
      }
      if (result.length >= 5) break
    }
  }

  return { tags: result.slice(0, 5) }
}

export async function suggestTags(
  input: SuggestTagsInput,
): Promise<RefinementResultEnvelope<SuggestTagsResult>> {
  const safeTitle = (input.title ?? '').trim()
  if (safeTitle.length === 0) {
    throw new Error('[INVALID_INPUT] El título no puede estar vacío')
  }

  try {
    const data = await callLLMObject({
      system: SYSTEM_SUGGEST_TAGS,
      prompt: buildSuggestTagsPrompt({
        ...input,
        title: safeTitle,
        existingTags: input.existingTags.slice(0, 30),
      }),
      schema: SuggestTagsSchema,
      cacheTtlMs: 60 * 60 * 1000,
      cacheKey: 'suggest-tags',
    })
    return { source: 'llm', data }
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return {
        source: 'heuristic',
        data: suggestTagsHeuristic({ ...input, title: safeTitle }),
        fallbackReason: 'ANTHROPIC_API_KEY no configurada',
      }
    }
    if (err instanceof LLMCallError) {
      return {
        source: 'heuristic',
        data: suggestTagsHeuristic({ ...input, title: safeTitle }),
        fallbackReason: 'La llamada al modelo falló',
      }
    }
    throw err
  }
}
