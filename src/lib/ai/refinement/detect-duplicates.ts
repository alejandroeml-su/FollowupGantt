/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — "Detectar duplicados".
 *
 * Compara una task de referencia contra hasta 50 candidatas del mismo
 * proyecto y devuelve los top 3 con `similarity > 0.7`.
 *
 * Sin embeddings reales (no hay store vectorial en el stack actual),
 * delegamos al LLM la comparación semántica en una sola llamada.
 *
 * Heurística de fallback: distancia de Levenshtein normalizada entre
 * títulos. Threshold > 0.85 para evitar falsos positivos. Suficiente
 * para detectar duplicados literales (typo, copy/paste).
 */

import {
  DetectDuplicatesSchema,
  type DetectDuplicatesResult,
  type DuplicateCandidate,
  type RefinementResultEnvelope,
} from './schemas'
import {
  callLLMObject,
  buildDetectDuplicatesPrompt,
  SYSTEM_DETECT_DUPLICATES,
  LLMDisabledError,
  LLMCallError,
} from './prompts'

export interface DetectDuplicatesTask {
  id: string
  title: string
  description?: string | null
}

export interface DetectDuplicatesInput {
  reference: DetectDuplicatesTask
  candidates: DetectDuplicatesTask[]
  /** Threshold mínimo (default 0.7). */
  minSimilarity?: number
  /** Top N (default 3). */
  topN?: number
}

// ─── Levenshtein normalizado ───────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const dp: number[] = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) dp[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1])
      }
      prev = tmp
    }
  }
  return dp[b.length]
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Similitud 0..1 basada en Levenshtein normalizado por la longitud
 * máxima. 1.0 = idéntico; 0.0 = totalmente diferente.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (na.length === 0 && nb.length === 0) return 1
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 0
  const dist = levenshtein(na, nb)
  return Math.max(0, 1 - dist / maxLen)
}

export function detectDuplicatesHeuristic(
  input: DetectDuplicatesInput,
): DetectDuplicatesResult {
  const min = input.minSimilarity ?? 0.85 // más conservador sin LLM
  const topN = input.topN ?? 3
  const candidates: DuplicateCandidate[] = []
  for (const cand of input.candidates) {
    if (cand.id === input.reference.id) continue
    const sim = titleSimilarity(input.reference.title, cand.title)
    if (sim >= min) {
      candidates.push({
        taskId: cand.id,
        similarity: Math.round(sim * 100) / 100,
        reason: `Similitud léxica de títulos (Levenshtein normalizado): ${(sim * 100).toFixed(0)}%`,
      })
    }
  }
  candidates.sort((a, b) => b.similarity - a.similarity)
  return { candidates: candidates.slice(0, topN) }
}

export async function detectDuplicates(
  input: DetectDuplicatesInput,
): Promise<RefinementResultEnvelope<DetectDuplicatesResult>> {
  const refTitle = (input.reference.title ?? '').trim()
  if (refTitle.length === 0) {
    throw new Error('[INVALID_INPUT] El título de referencia no puede estar vacío')
  }
  if (input.candidates.length === 0) {
    return { source: 'heuristic', data: { candidates: [] } }
  }

  const minSim = input.minSimilarity ?? 0.7
  const topN = input.topN ?? 3

  try {
    const data = await callLLMObject({
      system: SYSTEM_DETECT_DUPLICATES,
      prompt: buildDetectDuplicatesPrompt({
        reference: { ...input.reference, title: refTitle },
        candidates: input.candidates.slice(0, 50),
      }),
      schema: DetectDuplicatesSchema,
      // Cache corto (10 min): el set de tareas del proyecto cambia.
      cacheTtlMs: 10 * 60 * 1000,
      cacheKey: `detect-dup::${input.reference.id}`,
    })
    // Filtrar por threshold y top N (el modelo a veces devuelve más).
    const filtered = data.candidates
      .filter((c) => c.taskId !== input.reference.id)
      .filter((c) => c.similarity >= minSim)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN)
    return { source: 'llm', data: { candidates: filtered } }
  } catch (err) {
    if (err instanceof LLMDisabledError) {
      return {
        source: 'heuristic',
        data: detectDuplicatesHeuristic(input),
        fallbackReason: 'ANTHROPIC_API_KEY no configurada',
      }
    }
    if (err instanceof LLMCallError) {
      return {
        source: 'heuristic',
        data: detectDuplicatesHeuristic(input),
        fallbackReason: 'La llamada al modelo falló',
      }
    }
    throw err
  }
}
