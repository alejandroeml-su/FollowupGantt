/**
 * Wave P15 (Brain Project Insights AI) — Schemas + tipos puros.
 *
 * Sigue el patrón del repo: archivos `'use server'` solo exportan funciones
 * async · types/schemas viven en archivos puros gemelos.
 */

import { z } from 'zod'

export const InsightKindSchema = z.enum(['FORECAST', 'RECOMMENDATION', 'ANOMALY'])
export const InsightSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])
export const InsightActionTypeSchema = z.enum([
  'create_risk',
  'create_improvement',
  'create_task',
  'none',
])

/**
 * Schema del item generado por el LLM.
 *
 * NOTA: Anthropic structured output rechaza `min/max` en integer y
 * `nullable` en algunos casos · seguimos el patrón establecido en
 * `pm-types.ts` y `wbs-schema.ts` (rangos en describe + clamp en JS).
 */
export const InsightItemSchema = z.object({
  kind: InsightKindSchema,
  title: z.string().describe('Título corto y accionable (5-12 palabras).'),
  body: z
    .string()
    .describe(
      'Cuerpo de 2-4 frases con datos concretos (números, fechas, métricas).',
    ),
  severity: InsightSeveritySchema.describe(
    'HIGH si requiere acción inmediata · MEDIUM si esta semana · LOW informativo.',
  ),
  /** Acción opcional que el usuario podría aplicar con un click. */
  actionType: InsightActionTypeSchema.describe(
    'Tipo de acción aplicable: create_risk · create_improvement · create_task · none.',
  ),
  /** Payload para la acción (opcional · solo si actionType !== none). */
  actionPayload: z
    .object({
      taskMnemonic: z.string().optional(),
      probability: z.number().int().optional(),
      impact: z.number().int().optional(),
      mitigation: z.string().optional(),
      dueDate: z.string().optional(),
    })
    .optional(),
})

export const InsightsReportSchema = z.object({
  generatedAt: z.string(),
  projectName: z.string(),
  /** Top 9 insights priorizados (3 por kind máximo). El límite se enforces en system prompt. */
  insights: z.array(InsightItemSchema),
})

export type InsightItem = z.infer<typeof InsightItemSchema>
export type InsightsReport = z.infer<typeof InsightsReportSchema>

export interface ApplyInsightInput {
  insightId: string
}

export interface ApplyInsightResult {
  insightId: string
  status: 'APPLIED' | 'DISMISSED'
  /** Si la acción creó algo, su id (Risk/Improvement/Task). */
  createdEntityId?: string
  createdEntityKind?: 'risk' | 'improvement' | 'task'
}
