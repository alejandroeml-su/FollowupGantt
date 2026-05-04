/**
 * Wave P7 · Equipo P7-5 · Refinamiento IA de tasks — Esquemas zod.
 *
 * Outputs validados de cada acción de refinamiento. Diseñados para ser
 * consumidos tanto por `generateObject` (Anthropic) como por las
 * heurísticas de fallback. Los nombres de campos están en camelCase
 * porque la respuesta del modelo se parsea como JSON.
 */

import { z } from 'zod'

// ─── Improve description ───────────────────────────────────────────

/**
 * Resultado de "Mejorar descripción". Siempre devolvemos las tres claves
 * — el cliente decide cuáles aplicar.
 */
export const ImproveDescriptionSchema = z.object({
  improvedDescription: z
    .string()
    .min(10, 'La descripción mejorada debe tener al menos 10 caracteres')
    .max(4000, 'La descripción mejorada no debe exceder 4000 caracteres'),
  acceptanceCriteria: z
    .array(z.string().min(1).max(280))
    .max(8, 'Máximo 8 criterios de aceptación'),
  risks: z
    .array(z.string().min(1).max(280))
    .max(6, 'Máximo 6 riesgos identificados'),
})
export type ImproveDescriptionResult = z.infer<typeof ImproveDescriptionSchema>

// ─── Suggest checklist ─────────────────────────────────────────────

/**
 * Cada item del checklist es accionable, verificable y opcionalmente
 * marcado como "optional" (nice-to-have). 3..7 items.
 */
export const ChecklistItemSchema = z.object({
  text: z.string().min(3, 'El texto del item debe tener al menos 3 caracteres').max(200),
  optional: z.boolean(),
})
export const SuggestChecklistSchema = z.object({
  items: z.array(ChecklistItemSchema).min(3, 'Mínimo 3 items').max(7, 'Máximo 7 items'),
})
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>
export type SuggestChecklistResult = z.infer<typeof SuggestChecklistSchema>

// ─── Suggest tags ──────────────────────────────────────────────────

/**
 * Tags sugeridos. Se prefiere reutilizar tags existentes del proyecto;
 * el flag `reused` indica si la sugerencia ya existía. Limitamos a 5
 * para no inflar las tarjetas.
 */
export const SuggestedTagSchema = z.object({
  tag: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Solo letras/números/guion/underscore'),
  reused: z.boolean(),
})
export const SuggestTagsSchema = z.object({
  tags: z.array(SuggestedTagSchema).max(5),
})
export type SuggestedTag = z.infer<typeof SuggestedTagSchema>
export type SuggestTagsResult = z.infer<typeof SuggestTagsSchema>

// ─── Detect duplicates ─────────────────────────────────────────────

/**
 * Cada candidato de duplicado lleva el `taskId` de la otra tarea, una
 * `similarity` 0..1 y una `reason` legible. El consumidor filtra por
 * `> 0.7` y se queda con top 3.
 */
export const DuplicateCandidateSchema = z.object({
  taskId: z.string().min(1),
  similarity: z.number().min(0).max(1),
  reason: z.string().min(1).max(280),
})
export const DetectDuplicatesSchema = z.object({
  candidates: z.array(DuplicateCandidateSchema).max(10),
})
export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>
export type DetectDuplicatesResult = z.infer<typeof DetectDuplicatesSchema>

// ─── Refine categorization ─────────────────────────────────────────

/**
 * Refinamiento de `type` y `priority`. El LLM puede confirmar la
 * categorización heurística o sugerir otra con razonamiento.
 */
export const TaskTypeEnum = z.enum(['PHASE', 'AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET'])
export const PriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

export const RefineCategorizationSchema = z.object({
  suggestedType: TaskTypeEnum,
  suggestedPriority: PriorityEnum,
  reasoning: z.string().min(10, 'El razonamiento debe tener al menos 10 caracteres').max(500),
})
export type RefineCategorizationResult = z.infer<typeof RefineCategorizationSchema>

// ─── Source label ──────────────────────────────────────────────────

/**
 * Etiqueta de origen de la sugerencia. Cada acción retorna además este
 * campo para que la UI distinga "Generado con IA · Anthropic" vs
 * "Heurística (LLM disabled)".
 */
export type RefinementSource = 'llm' | 'heuristic'

export interface RefinementResultEnvelope<T> {
  source: RefinementSource
  data: T
  /** Razón corta cuando caemos a heurística (sin API key, error, etc.). */
  fallbackReason?: string
}
