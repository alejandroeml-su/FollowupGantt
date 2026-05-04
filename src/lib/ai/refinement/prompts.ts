/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA — Prompts y adapter LLM.
 *
 * Este archivo concentra dos responsabilidades:
 *
 *   1) Prompts (system + builder de user prompt) para cada una de las 5
 *      acciones de refinamiento. Centralizar los strings facilita ajuste
 *      sin tocar la lógica.
 *   2) Un adapter mínimo `callLLMObject` que envuelve `generateObject` del
 *      AI SDK (`ai` + `@ai-sdk/anthropic`) con:
 *        - Detección de `ANTHROPIC_API_KEY`. Sin clave → lanza
 *          `LLM_DISABLED` (capturable por las heurísticas de fallback).
 *        - Cache en memoria (Map) con TTL configurable. Llave = hash
 *          determinista de `system + prompt + schema-fingerprint`.
 *        - Modelo Claude Sonnet (versión configurable por env
 *          `LLM_MODEL_REFINEMENT`, default `claude-sonnet-4-6`).
 *
 *  NOTA: el equipo P7-1 (LLM adapter base) aún no ha aterrizado en master.
 *  Este wrapper local cumple la misma función para P7-5 sin tocar archivos
 *  fuera de `src/lib/ai/refinement/`. Cuando el adapter base llegue se
 *  reemplaza este archivo por re-exports.
 */

import type { z } from 'zod'

// ─── Tipos compartidos ─────────────────────────────────────────────

export interface CallLLMOptions<TSchema extends z.ZodTypeAny> {
  /** Mensaje system (instrucciones de rol). */
  system: string
  /** Mensaje user (contexto + input concreto). */
  prompt: string
  /** Schema zod que valida el output. */
  schema: TSchema
  /** Cache TTL en ms. 0 deshabilita cache. Default 1h. */
  cacheTtlMs?: number
  /** Etiqueta opcional para ayudar a depurar el cache. */
  cacheKey?: string
}

export class LLMDisabledError extends Error {
  constructor(message = 'ANTHROPIC_API_KEY no está configurada') {
    super(message)
    this.name = 'LLMDisabledError'
  }
}

export class LLMCallError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LLMCallError'
  }
}

// ─── Cache TTL en memoria ──────────────────────────────────────────

interface CacheEntry {
  value: unknown
  expiresAt: number
}

const _cache = new Map<string, CacheEntry>()

function cacheGet<T>(key: string): T | undefined {
  const entry = _cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    _cache.delete(key)
    return undefined
  }
  return entry.value as T
}

function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (ttlMs <= 0) return
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

/** Borra todo el cache. Útil en tests y para "Re-generar" en UI. */
export function clearRefinementCache(): void {
  _cache.clear()
}

/** Snapshot read-only del tamaño actual del cache (debug/tests). */
export function refinementCacheSize(): number {
  return _cache.size
}

// Hash determinista FNV-1a 32-bit. No criptográfico, solo para llaves.
function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16)
}

// ─── Adapter LLM ───────────────────────────────────────────────────

/**
 * Llama al modelo y devuelve un objeto validado por `schema`. Lanza:
 *   - `LLMDisabledError` si no hay `ANTHROPIC_API_KEY`.
 *   - `LLMCallError` si el modelo falla (red, parse, validación zod).
 *
 * El AI SDK ya valida el output contra el schema internamente; aquí
 * solo añadimos cache + detección de feature flag.
 */
export async function callLLMObject<TSchema extends z.ZodTypeAny>(
  opts: CallLLMOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LLMDisabledError()
  }

  const ttl = opts.cacheTtlMs ?? 60 * 60 * 1000
  const key = `${opts.cacheKey ?? ''}::${fnv1a(opts.system)}::${fnv1a(opts.prompt)}`
  const cached = cacheGet<z.infer<TSchema>>(key)
  if (cached !== undefined) return cached

  // Lazy-load del SDK para no impactar startup ni tests que no necesitan el LLM.
  let generateObjectFn: typeof import('ai').generateObject
  let anthropicFactory: typeof import('@ai-sdk/anthropic').anthropic
  try {
    const aiMod = await import('ai')
    const anthropicMod = await import('@ai-sdk/anthropic')
    generateObjectFn = aiMod.generateObject
    anthropicFactory = anthropicMod.anthropic
  } catch (err) {
    throw new LLMCallError('No se pudo cargar el SDK de IA', err)
  }

  const modelId = process.env.LLM_MODEL_REFINEMENT || 'claude-sonnet-4-6'

  try {
    const { object } = await generateObjectFn({
      model: anthropicFactory(modelId),
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
    })
    cacheSet(key, object, ttl)
    return object as z.infer<TSchema>
  } catch (err) {
    throw new LLMCallError('La llamada al modelo falló', err)
  }
}

// ─── Prompts: Improve description ──────────────────────────────────

export const SYSTEM_IMPROVE_DESCRIPTION = `Eres analista senior de proyectos PMI/Agile/ITIL del Complejo Avante.

Tu tarea: expandir un título corto de tarea a una descripción técnica clara, profesional y accionable, en español.

Reglas:
- La descripción mejorada debe ser concisa pero completa: contexto, objetivo y entregable esperado.
- Los criterios de aceptación deben ser verificables (cada uno empieza con un verbo en infinitivo).
- Los riesgos deben ser concretos (no genéricos como "puede haber problemas").
- No inventes integraciones, áreas o personas que no estén mencionadas.
- Mantén el tono profesional y directo. Sin markdown decorativo (ni listas con ##), solo texto plano.`

export function buildImproveDescriptionPrompt(input: {
  title: string
  currentDescription?: string | null
  projectContext?: string | null
}): string {
  const parts: string[] = []
  parts.push(`Título de la tarea: "${input.title}"`)
  if (input.currentDescription && input.currentDescription.trim().length > 0) {
    parts.push(`Descripción actual:\n${input.currentDescription.trim()}`)
  } else {
    parts.push('Descripción actual: (vacía — partimos solo del título)')
  }
  if (input.projectContext && input.projectContext.trim().length > 0) {
    parts.push(`Contexto del proyecto: ${input.projectContext.trim()}`)
  }
  parts.push(
    'Devuelve un objeto JSON con: improvedDescription (string), acceptanceCriteria (string[] de 3-6), risks (string[] de 2-4).',
  )
  return parts.join('\n\n')
}

// ─── Prompts: Suggest checklist ────────────────────────────────────

export const SYSTEM_SUGGEST_CHECKLIST = `Eres especialista en descomposición de trabajo (WBS) para tareas de proyectos.

Tu tarea: a partir del título y descripción de una tarea, generar entre 3 y 7 items de checklist accionables y verificables, en español.

Reglas:
- Cada item debe empezar con un verbo en infinitivo (Diseñar, Implementar, Validar, Documentar, etc.).
- Los items deben estar en orden lógico de ejecución.
- Marca como "optional: true" únicamente los items que sean nice-to-have, no requeridos para considerar la tarea hecha.
- No repitas el título como item.
- Cada item < 200 caracteres.`

export function buildSuggestChecklistPrompt(input: {
  title: string
  description?: string | null
}): string {
  const parts: string[] = []
  parts.push(`Título: "${input.title}"`)
  if (input.description && input.description.trim().length > 0) {
    parts.push(`Descripción:\n${input.description.trim()}`)
  } else {
    parts.push('Descripción: (vacía)')
  }
  parts.push(
    'Devuelve un objeto JSON con: items (array de 3-7 objetos { text, optional }).',
  )
  return parts.join('\n\n')
}

// ─── Prompts: Suggest tags ─────────────────────────────────────────

export const SYSTEM_SUGGEST_TAGS = `Eres taxonomista de proyectos. Sugieres etiquetas (tags) cortas para clasificar tareas.

Tu tarea: extraer 1-5 tags relevantes del contenido de la tarea.

Reglas:
- Tags en español, en kebab-case o snake_case (sin espacios, solo letras/números/guion/underscore).
- Cada tag entre 2 y 32 caracteres.
- Si la tarea menciona conceptos que ya están en la lista de tags existentes del proyecto, REUTILÍZALOS (marca reused: true).
- Solo sugiere tags nuevos cuando sean claramente más relevantes que los existentes.
- Sin tags genéricos ("trabajo", "tarea", "proyecto").`

export function buildSuggestTagsPrompt(input: {
  title: string
  description?: string | null
  existingTags: string[]
}): string {
  const parts: string[] = []
  parts.push(`Título: "${input.title}"`)
  if (input.description && input.description.trim().length > 0) {
    parts.push(`Descripción:\n${input.description.trim()}`)
  }
  if (input.existingTags.length > 0) {
    parts.push(
      `Tags existentes en el proyecto (top 30 por uso): ${input.existingTags.join(', ')}`,
    )
  } else {
    parts.push('Tags existentes en el proyecto: (ninguno)')
  }
  parts.push(
    'Devuelve un objeto JSON con: tags (array de hasta 5 objetos { tag, reused }).',
  )
  return parts.join('\n\n')
}

// ─── Prompts: Detect duplicates ────────────────────────────────────

export const SYSTEM_DETECT_DUPLICATES = `Eres asistente de project management que detecta tareas duplicadas o muy similares dentro de un proyecto.

Tu tarea: comparar una tarea de referencia contra una lista de tareas candidatas y devolver hasta 3 candidatos con similarity > 0.7.

Reglas:
- similarity = 1.0 cuando son prácticamente la misma tarea (mismo objetivo, mismo entregable).
- similarity ~ 0.85 cuando se solapan fuertemente (mismo área, parcialmente mismo objetivo).
- similarity ~ 0.7 cuando comparten un componente importante pero podrían coexistir.
- similarity < 0.7 → NO lo incluyas en la respuesta.
- reason: explicación corta (1 frase) en español.
- Nunca incluyas la tarea de referencia como candidato.`

export function buildDetectDuplicatesPrompt(input: {
  reference: { id: string; title: string; description?: string | null }
  candidates: Array<{ id: string; title: string; description?: string | null }>
}): string {
  const parts: string[] = []
  parts.push(
    `Tarea de referencia (ID ${input.reference.id}):\nTítulo: ${input.reference.title}\nDescripción: ${
      input.reference.description?.trim() || '(vacía)'
    }`,
  )
  parts.push('Tareas candidatas:')
  for (const c of input.candidates) {
    parts.push(
      `- ID ${c.id} | ${c.title}${
        c.description ? ` | ${c.description.slice(0, 120)}` : ''
      }`,
    )
  }
  parts.push(
    'Devuelve un objeto JSON con: candidates (array de hasta 10 objetos { taskId, similarity, reason }). Filtra >0.7.',
  )
  return parts.join('\n\n')
}

// ─── Prompts: Refine categorization ────────────────────────────────

export const SYSTEM_REFINE_CATEGORIZATION = `Eres categorizador experto en metodologías PMI, Agile e ITIL.

Tu tarea: dado el título y descripción de una tarea, sugerir el TaskType y Priority más apropiados, con razonamiento.

Reglas para TaskType:
- PHASE: hito o fase de un cronograma (entrega mayor, milestone).
- AGILE_STORY: historia de usuario, refactor, investigación, meeting recurrente.
- PMI_TASK: entregable formal de proyecto (diseño, documentación, release).
- ITIL_TICKET: incidente, bug, soporte, infraestructura, problema operativo.

Reglas para Priority:
- CRITICAL: bloquea producción o un release; impacto a usuarios externos.
- HIGH: bloquea otra tarea importante o tiene fecha límite cercana.
- MEDIUM: trabajo normal del sprint.
- LOW: nice-to-have, sin urgencia.

Si hay una sugerencia previa de heurística, considérala pero NO te limites a copiarla; corrígela si la lectura semántica del título/descripción lo amerita.

El razonamiento debe ser de 1-3 frases en español, mencionando las palabras clave o señales que justifican la decisión.`

export function buildRefineCategorizationPrompt(input: {
  title: string
  description?: string | null
  currentType: string
  currentPriority: string
  heuristicHint?: { suggestedType: string; reasoning: string[] } | null
}): string {
  const parts: string[] = []
  parts.push(`Título: "${input.title}"`)
  parts.push(`Descripción: ${input.description?.trim() || '(vacía)'}`)
  parts.push(`Type actual: ${input.currentType}`)
  parts.push(`Priority actual: ${input.currentPriority}`)
  if (input.heuristicHint) {
    parts.push(
      `Sugerencia heurística previa (P5-4): type=${input.heuristicHint.suggestedType}; razones=${input.heuristicHint.reasoning.join(' | ')}`,
    )
  }
  parts.push(
    'Devuelve un objeto JSON con: suggestedType, suggestedPriority, reasoning.',
  )
  return parts.join('\n\n')
}
