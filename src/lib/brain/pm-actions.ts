'use server'

import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import prisma from '@/lib/prisma'

// ─── Schemas ──────────────────────────────────────────────────────

export const StandupReportSchema = z.object({
  date: z.string().describe('Fecha del stand-up en formato YYYY-MM-DD.'),
  summary: z.string().describe('Resumen ejecutivo de 1-2 frases sobre la actividad de hoy.'),
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
  blockers: z.array(z.string()).describe('Cuellos de botella o tareas detenidas que requieren atención.'),
  globalProgressNote: z.string().describe('Nota corta sobre avance global o tendencia.'),
})

export type StandupReport = z.infer<typeof StandupReportSchema>

export const RiskAlertSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  type: z.enum(['OVERDUE', 'CRITICAL_TASK', 'EVM_DEVIATION', 'DEPENDENCY_VIOLATION', 'STALE']),
  taskMnemonic: z.string().nullable(),
  title: z.string().describe('Título corto del riesgo (5-10 palabras).'),
  rationale: z.string().describe('Explicación de 1-2 frases del por qué es riesgo, con datos concretos.'),
  suggestedAction: z.string().describe('Acción concreta y accionable.'),
})

export const RiskReportSchema = z.object({
  date: z.string(),
  overallStatus: z.enum(['HEALTHY', 'AT_RISK', 'CRITICAL']),
  headline: z.string().describe('Frase de titular sobre el estado general.'),
  alerts: z.array(RiskAlertSchema).max(5).describe('Top 5 alertas priorizadas por severidad.'),
})

export type RiskReport = z.infer<typeof RiskReportSchema>

// ─── Context gathering ────────────────────────────────────────────

async function gatherStandupContext(projectId?: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentHistory = await prisma.taskHistory.findMany({
    where: {
      createdAt: { gte: since },
      task: projectId ? { projectId } : undefined,
    },
    take: 80,
    orderBy: { createdAt: 'desc' },
    select: {
      field: true,
      oldValue: true,
      newValue: true,
      createdAt: true,
      user: { select: { name: true } },
      task: {
        select: {
          mnemonic: true,
          title: true,
          status: true,
          progress: true,
          project: { select: { name: true } },
        },
      },
    },
  })
  const inProgress = await prisma.task.findMany({
    where: {
      status: 'IN_PROGRESS',
      archivedAt: null,
      ...(projectId && { projectId }),
    },
    take: 40,
    orderBy: { updatedAt: 'desc' },
    select: {
      mnemonic: true,
      title: true,
      progress: true,
      assignee: { select: { name: true } },
      project: { select: { name: true } },
    },
  })
  return { since: since.toISOString(), recentHistory, inProgress }
}

async function gatherRiskContext(projectId?: string) {
  const now = new Date()
  const overdue = await prisma.task.findMany({
    where: {
      archivedAt: null,
      status: { not: 'DONE' },
      endDate: { lt: now },
      ...(projectId && { projectId }),
    },
    take: 25,
    orderBy: [{ priority: 'desc' }, { endDate: 'asc' }],
    select: {
      mnemonic: true,
      title: true,
      status: true,
      priority: true,
      progress: true,
      endDate: true,
      project: { select: { name: true, spi: true, cpi: true } },
      assignee: { select: { name: true } },
    },
  })
  const criticalOpen = await prisma.task.findMany({
    where: {
      archivedAt: null,
      priority: 'CRITICAL',
      status: { not: 'DONE' },
      ...(projectId && { projectId }),
    },
    take: 20,
    select: {
      mnemonic: true,
      title: true,
      status: true,
      progress: true,
      endDate: true,
      project: { select: { name: true } },
    },
  })
  const projects = await prisma.project.findMany({
    where: projectId ? { id: projectId } : undefined,
    take: 10,
    select: { id: true, name: true, spi: true, cpi: true, status: true },
  })
  return {
    now: now.toISOString().slice(0, 10),
    overdue: overdue.map((t) => ({
      ...t,
      endDate: t.endDate?.toISOString().slice(0, 10),
      daysOverdue: t.endDate
        ? Math.ceil((now.getTime() - t.endDate.getTime()) / 86_400_000)
        : null,
    })),
    criticalOpen: criticalOpen.map((t) => ({
      ...t,
      endDate: t.endDate?.toISOString().slice(0, 10),
    })),
    projects,
  }
}

// ─── Server actions ───────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)

export async function generateStandupReport(input?: { projectId?: string }): Promise<StandupReport> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no está configurada en el servidor.')
  }
  const ctx = await gatherStandupContext(input?.projectId)
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: StandupReportSchema,
    system: `Eres Avante Brain, asistente del Project Manager AI de FollowupGantt.

Generas stand-ups ejecutivos en español a partir de la actividad real de las últimas 24h del sistema.

Reglas:
- Sé conciso. El \`summary\` no debe pasar de 2 frases.
- Sólo incluye usuarios con actividad real (no inventes nombres).
- "Completado hoy" = entradas de TaskHistory donde field='status' y newValue='DONE'.
- "En progreso" = tareas con status=IN_PROGRESS asignadas al usuario.
- Si no hay actividad, sé honesto: "No hubo cambios registrados en las últimas 24h."
- Identifica blockers reales: tareas IN_PROGRESS sin progreso (progress=0) o atrasadas con prioridad alta.
- No inventes proyectos ni datos.`,
    prompt: `Fecha actual: ${today()}\n\nActividad de las últimas 24h:\n${JSON.stringify(ctx, null, 2)}`,
  })
  return object
}

export async function generateRiskAnalysis(input?: { projectId?: string }): Promise<RiskReport> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no está configurada en el servidor.')
  }
  const ctx = await gatherRiskContext(input?.projectId)
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: RiskReportSchema,
    system: `Eres Avante Brain, especialista en gestión de proyectos PMI/Agile/ITIL de FollowupGantt.

Analizas datos de proyectos y devuelves alertas accionables en español.

Reglas:
- Devuelve **máximo 5 alertas**, priorizadas por severidad (HIGH > MEDIUM > LOW).
- Cada alerta debe tener \`rationale\` con datos concretos (días atrasados, % avance, SPI numérico).
- \`overallStatus\`:
  - HEALTHY = sin atrasos críticos y SPI/CPI >= 0.95
  - AT_RISK = 1-3 atrasos no-críticos o SPI 0.85-0.94
  - CRITICAL = atrasos en tareas CRITICAL o SPI < 0.85
- \`type\` de alerta:
  - OVERDUE: tarea pasó endDate y no está DONE
  - CRITICAL_TASK: tarea con priority=CRITICAL en riesgo
  - EVM_DEVIATION: SPI o CPI por debajo de 0.9
  - DEPENDENCY_VIOLATION: predecesora no terminada que bloquea sucesora
  - STALE: tarea IN_PROGRESS sin avance (progress=0)
- \`suggestedAction\` debe ser concreta: "Reasignar a X", "Escalar a sponsor", "Acortar alcance", no genérica.
- Si todo está saludable, devuelve un solo alert informativo de severity=LOW.`,
    prompt: `Datos de proyectos:\n${JSON.stringify(ctx, null, 2)}`,
  })
  return object
}
