'use server'

import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import prisma from '@/lib/prisma'
import {
  StandupReportSchema,
  RiskReportSchema,
  type StandupReport,
  type RiskReport,
  type RegisterRiskInput,
  type RegisterRiskResult,
  type BrainProjectOption,
} from './pm-types'

// NOTA: NO re-exportamos types/schemas desde aquí. En archivos `'use server'`
// Turbopack rompe `export const` y `export type {}` con ReferenceError en
// runtime. Los consumidores deben importar tipos directamente de
// `@/lib/brain/pm-types`.

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

async function gatherRiskContext(projectId: string) {
  const now = new Date()
  const overdue = await prisma.task.findMany({
    where: {
      archivedAt: null,
      status: { not: 'DONE' },
      endDate: { lt: now },
      projectId,
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
      projectId,
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
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      spi: true,
      cpi: true,
      status: true,
      methodology: true,
    },
  })

  // Wave P14c — risks YA REGISTRADOS en el proyecto, para que el LLM no
  // los re-sugiera. Solo abiertos/en-mitigación (los CLOSED son históricos).
  const existingRisks = await prisma.risk.findMany({
    where: {
      projectId,
      status: { in: ['OPEN', 'MITIGATING'] },
    },
    select: {
      title: true,
      probability: true,
      impact: true,
      task: { select: { mnemonic: true, title: true } },
    },
    take: 50,
  })

  return {
    now: now.toISOString().slice(0, 10),
    project,
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
    existingRisks: existingRisks.map((r) => ({
      title: r.title,
      probability: r.probability,
      impact: r.impact,
      taskMnemonic: r.task?.mnemonic ?? null,
    })),
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

export async function generateRiskAnalysis(input: { projectId: string }): Promise<RiskReport> {
  if (!input?.projectId) {
    throw new Error('[BRAIN_AI] projectId es obligatorio para análisis de riesgos.')
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      '[BRAIN_AI] ANTHROPIC_API_KEY no está configurada en el servidor (Vercel env vars).',
    )
  }

  let ctx
  try {
    ctx = await gatherRiskContext(input.projectId)
  } catch (err) {
    throw new Error(
      `[BRAIN_AI] Error al cargar contexto del proyecto: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!ctx.project) {
    throw new Error(`[BRAIN_AI] Proyecto ${input.projectId} no existe`)
  }

  let object: RiskReport
  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: RiskReportSchema,
    system: `Eres Avante Brain, especialista en gestión de proyectos PMI/Agile/ITIL de FollowupGantt.

Analizas datos del proyecto **${ctx.project.name}** (metodología ${ctx.project.methodology}) y devuelves
alertas accionables en español, calibradas a la matriz PMBOK 5×5.

Reglas:
- Devuelve **máximo 5 alertas**, priorizadas por severidad (HIGH > MEDIUM > LOW).
- Cada alerta debe tener \`rationale\` con datos concretos (días atrasados, % avance, SPI numérico).
- Cada alerta DEBE incluir \`probability\` (1-5), \`impact\` (1-5) y \`triggerDelayDays\` (días extra
  al cronograma si el riesgo se materializa, 0 si no aplica delay temporal).
- Calibración matriz 5×5:
  · prob 1-2 = improbable; 3 = posible; 4-5 = casi seguro
  · impact 1-2 = molestia; 3 = afecta release; 4 = afecta milestone; 5 = catastrófico
- \`severity\` se deriva del producto P×I:
  · HIGH si P×I >= 12 · MEDIUM si 6-11 · LOW si <= 5
- \`overallStatus\`:
  · HEALTHY = sin atrasos críticos y SPI/CPI >= 0.95
  · AT_RISK = 1-3 atrasos no-críticos o SPI 0.85-0.94
  · CRITICAL = atrasos en tareas CRITICAL o SPI < 0.85
- \`type\` de alerta:
  · OVERDUE: tarea pasó endDate y no está DONE
  · CRITICAL_TASK: tarea con priority=CRITICAL en riesgo
  · EVM_DEVIATION: SPI o CPI por debajo de 0.9
  · DEPENDENCY_VIOLATION: predecesora no terminada que bloquea sucesora
  · STALE: tarea IN_PROGRESS sin avance (progress=0)
- \`taskMnemonic\` DEBE ser el mnemonic exacto de la tarea más relacionada (ej. "p9-3"),
  o vacío/omitirlo si la alerta es global del proyecto (ej. EVM_DEVIATION).
- \`suggestedAction\` debe ser una mitigación concreta y accionable que vaya directo al
  campo \`Risk.mitigation\` del Risk Register: "Reasignar a X", "Escalar a sponsor",
  "Acortar alcance", no genérica.

🚫 **DEDUPE OBLIGATORIO**: el campo \`existingRisks\` del contexto contiene los riesgos
YA REGISTRADOS en el Risk Register de este proyecto. **NO sugieras alertas que dupliquen
en concepto** un riesgo ya registrado (compara title + taskMnemonic). Si todos los
problemas relevantes ya están registrados, devuelve un solo alert LOW informativo.

- Si todo está saludable y no hay riesgos NUEVOS para sugerir, devuelve un único alert
  informativo de severity=LOW indicándolo expresamente.`,
      prompt: `Datos del proyecto a analizar:\n${JSON.stringify(ctx, null, 2)}`,
    })
    object = result.object
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`[BRAIN_AI] LLM falló al generar análisis de riesgos: ${msg}`)
  }
  return object
}

// ─── Wave P14c — Registrar alerta como Risk en BD ────────────────────

/**
 * Persiste una alerta del Project Manager AI como un `Risk` formal en
 * el Risk Register del proyecto. Resuelve `taskMnemonic → taskId` si
 * no se pasó explícito y la mnemonic existe en el mismo proyecto.
 */
export async function registerRiskFromAlert(
  input: RegisterRiskInput,
): Promise<RegisterRiskResult> {
  if (!input.projectId)
    throw new Error('[INVALID_INPUT] projectId requerido')
  if (!input.alert?.title?.trim())
    throw new Error('[INVALID_INPUT] alert.title requerido')

  // Resolver taskId desde mnemonic si no viene explícito.
  let taskId = input.taskId ?? null
  if (!taskId && input.alert.taskMnemonic) {
    const task = await prisma.task.findFirst({
      where: {
        projectId: input.projectId,
        mnemonic: input.alert.taskMnemonic,
        archivedAt: null,
      },
      select: { id: true },
    })
    taskId = task?.id ?? null
  }

  const created = await prisma.risk.create({
    data: {
      projectId: input.projectId,
      taskId,
      title: input.alert.title.trim().slice(0, 200),
      description: input.alert.rationale.slice(0, 500),
      probability: input.alert.probability,
      impact: input.alert.impact,
      mitigation: input.alert.suggestedAction.slice(0, 500),
      triggerDelayDays: input.alert.triggerDelayDays ?? null,
      status: 'OPEN',
    },
    select: { id: true, taskId: true },
  })

  return { riskId: created.id, taskId: created.taskId }
}

// ─── Wave P14c — Catálogo de proyectos para selector UI ──────────────

export async function listProjectsForBrainAnalysis(): Promise<BrainProjectOption[]> {
  const projects = await prisma.project.findMany({
    where: { OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }] },
    select: {
      id: true,
      name: true,
      methodology: true,
      status: true,
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  })
  return projects
}
