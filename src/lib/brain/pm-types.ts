/**
 * Schemas + tipos puros para Project Manager AI.
 *
 * Extraído de `pm-actions.ts` (que es `'use server'`) porque Turbopack
 * rompe `export const Schema` y `export type` en archivos Server Action
 * con un `ReferenceError: X is not defined` en runtime.
 *
 * Patrón establecido en el repo (también aplicado en `saved-views.ts`):
 *   - Archivos `'use server'` SOLO exportan funciones `async`.
 *   - Constantes / schemas / types viven en archivos puros gemelos.
 */

import { z } from 'zod'

// ─── Standup ──────────────────────────────────────────────────────

export const StandupReportSchema = z.object({
  date: z.string().describe('Fecha del stand-up en formato YYYY-MM-DD.'),
  summary: z
    .string()
    .describe('Resumen ejecutivo de 1-2 frases sobre la actividad de hoy.'),
  byUser: z
    .array(
      z.object({
        userName: z.string(),
        completedToday: z.array(
          z.object({
            mnemonic: z.string().nullable(),
            title: z.string(),
            project: z.string().nullable(),
          }),
        ),
        inProgress: z.array(
          z.object({
            mnemonic: z.string().nullable(),
            title: z.string(),
            progress: z.number(),
            project: z.string().nullable(),
          }),
        ),
      }),
    )
    .describe('Actividad agrupada por usuario.'),
  blockers: z
    .array(z.string())
    .describe('Cuellos de botella o tareas detenidas que requieren atención.'),
  globalProgressNote: z
    .string()
    .describe('Nota corta sobre avance global o tendencia.'),
})

export type StandupReport = z.infer<typeof StandupReportSchema>

// ─── Risk analysis ────────────────────────────────────────────────

export const RiskAlertSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  type: z.enum([
    'OVERDUE',
    'CRITICAL_TASK',
    'EVM_DEVIATION',
    'DEPENDENCY_VIOLATION',
    'STALE',
  ]),
  taskMnemonic: z.string().nullable(),
  title: z.string().describe('Título corto del riesgo (5-10 palabras).'),
  rationale: z
    .string()
    .describe('Explicación de 1-2 frases del por qué es riesgo, con datos concretos.'),
  suggestedAction: z.string().describe('Acción concreta y accionable.'),
})

export const RiskReportSchema = z.object({
  date: z.string(),
  overallStatus: z.enum(['HEALTHY', 'AT_RISK', 'CRITICAL']),
  headline: z.string().describe('Frase de titular sobre el estado general.'),
  // NOTA: NO usar `.max(N)` aquí — Anthropic structured output rechaza
  // `maxItems` con: "output_config.format.schema: For 'array' type,
  // property 'maxItems' is not supported". El límite (top 5) se enforced
  // vía system prompt.
  alerts: z
    .array(RiskAlertSchema)
    .describe('Top 5 alertas priorizadas por severidad (máx 5).'),
})

export type RiskReport = z.infer<typeof RiskReportSchema>
