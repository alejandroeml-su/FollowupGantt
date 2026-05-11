/**
 * Schema + tipo puro para Writer AI.
 *
 * Extraído de `writer-actions.ts` por la misma razón que `pm-types.ts`:
 * Turbopack rompe `export const Schema` en archivos `'use server'`.
 */

import { z } from 'zod'

export const WriterImprovedDescriptionSchema = z.object({
  improvedTitle: z
    .string()
    .describe(
      'Título mejorado de la tarea, claro y específico (máximo 80 chars). Usa verbo en infinitivo o imperativo.',
    ),
  improvedDescription: z
    .string()
    .describe(
      'Descripción reescrita en formato Markdown profesional. Usa el patrón "Como [rol], quiero [acción], para [beneficio]" cuando aplique.',
    ),
  // NOTA: sin `.min(2).max(6)` — Anthropic structured output rechaza
  // `minItems`/`maxItems`. El rango se enforced en el system prompt.
  acceptanceCriteria: z
    .array(z.string())
    .describe(
      'Entre 2 y 6 criterios de aceptación verificables (binarios: pasa o no pasa).',
    ),
  rationale: z
    .string()
    .describe(
      'Nota corta de 1-2 frases explicando qué cambió respecto al texto original y por qué.',
    ),
})

export type WriterImprovedDescription = z.infer<
  typeof WriterImprovedDescriptionSchema
>

export type WriterFilterOptions = {
  projects: Array<{ id: string; name: string }>
  epics: Array<{ id: string; name: string; projectId: string }>
  sprints: Array<{
    id: string
    name: string
    projectId: string
    status: string
  }>
  userStories: Array<{
    id: string
    mnemonic: string | null
    title: string
    projectId: string
    epicId: string | null
    sprintId: string | null
  }>
}
