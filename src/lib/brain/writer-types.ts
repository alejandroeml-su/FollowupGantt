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
  acceptanceCriteria: z
    .array(z.string())
    .min(2)
    .max(6)
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
