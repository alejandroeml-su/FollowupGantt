'use server'

/**
 * Wave P15 (Brain Project Insights AI ampliado) — Server actions.
 *
 * Genera insights predictivos contextualizados al proyecto: forecast
 * cuantitativo + recomendaciones accionables + anomalías detectadas.
 * Persiste en `BrainInsight` para tracking + dedupe en futuras runs
 * (no re-sugerir lo ya APPLIED/DISMISSED).
 *
 * Fallback heurístico cuando el LLM falla (mismo patrón que Wave P14c
 * Risk Analysis).
 */

import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import {
  InsightsReportSchema,
  type InsightsReport,
  type InsightItem,
  type ApplyInsightInput,
  type ApplyInsightResult,
} from './insights-types'

// ────────────────────── Context gathering ──────────────────────

async function gatherInsightsContext(projectId: string) {
  const now = new Date()
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      methodology: true,
      status: true,
      cpi: true,
      spi: true,
      budget: true,
    },
  })
  if (!project) return null

  const [taskStats, sprints, risks, recentSnapshots, existingInsights] =
    await Promise.all([
      prisma.task.groupBy({
        by: ['status'],
        where: { projectId, archivedAt: null },
        _count: true,
        _sum: { storyPoints: true },
      }),
      prisma.sprint.findMany({
        where: { projectId },
        select: {
          id: true,
          name: true,
          status: true,
          startDate: true,
          endDate: true,
          velocityActual: true,
          capacity: true,
        },
        orderBy: { startDate: 'desc' },
        take: 6,
      }),
      prisma.risk.findMany({
        where: { projectId, status: { in: ['OPEN', 'MITIGATING'] } },
        select: { title: true, probability: true, impact: true },
        take: 10,
      }),
      prisma.eVMSnapshot.findMany({
        where: { projectId },
        orderBy: { snapshotDate: 'desc' },
        take: 3,
        select: {
          snapshotDate: true,
          plannedValue: true,
          earnedValue: true,
          actualCost: true,
          cpi: true,
          spi: true,
        },
      }),
      // Wave P15 — insights ya generados (NEW) o aplicados/descartados ·
      // se pasan al LLM para evitar duplicación.
      prisma.brainInsight.findMany({
        where: { projectId, status: { in: ['NEW', 'APPLIED', 'DISMISSED'] } },
        select: { title: true, kind: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ])

  const taskSummary = {
    total: taskStats.reduce((acc, t) => acc + t._count, 0),
    todo: taskStats.find((t) => t.status === 'TODO')?._count ?? 0,
    inProgress: taskStats.find((t) => t.status === 'IN_PROGRESS')?._count ?? 0,
    review: taskStats.find((t) => t.status === 'REVIEW')?._count ?? 0,
    done: taskStats.find((t) => t.status === 'DONE')?._count ?? 0,
    spDone: Number(taskStats.find((t) => t.status === 'DONE')?._sum.storyPoints ?? 0),
    spPending:
      Number(taskStats.find((t) => t.status === 'TODO')?._sum.storyPoints ?? 0) +
      Number(
        taskStats.find((t) => t.status === 'IN_PROGRESS')?._sum.storyPoints ?? 0,
      ) +
      Number(taskStats.find((t) => t.status === 'REVIEW')?._sum.storyPoints ?? 0),
  }

  return {
    now: now.toISOString().slice(0, 10),
    project,
    taskSummary,
    sprints: sprints.map((s) => ({
      ...s,
      startDate: s.startDate.toISOString().slice(0, 10),
      endDate: s.endDate.toISOString().slice(0, 10),
    })),
    risks,
    recentSnapshots: recentSnapshots.map((s) => ({
      date: s.snapshotDate.toISOString().slice(0, 10),
      pv: Number(s.plannedValue),
      ev: Number(s.earnedValue),
      ac: Number(s.actualCost),
      cpi: s.cpi,
      spi: s.spi,
    })),
    existingInsights: existingInsights.map((i) => ({
      title: i.title,
      kind: i.kind,
      status: i.status,
    })),
  }
}

// ────────────────────── Generate insights ──────────────────────

export async function generateProjectInsights(input: {
  projectId: string
}): Promise<InsightsReport> {
  if (!input?.projectId) {
    throw new Error('[BRAIN_AI] projectId es obligatorio para generar insights.')
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      '[BRAIN_AI] ANTHROPIC_API_KEY no está configurada en el servidor.',
    )
  }

  let ctx
  try {
    ctx = await gatherInsightsContext(input.projectId)
  } catch (err) {
    throw new Error(
      `[BRAIN_AI] Error al cargar contexto: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!ctx) {
    throw new Error(`[BRAIN_AI] Proyecto ${input.projectId} no existe`)
  }

  let report: InsightsReport
  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: InsightsReportSchema,
      system: `Eres Avante Brain · Project Insights AI. Generas análisis predictivo
proactivo del proyecto **${ctx.project.name}** (metodología ${ctx.project.methodology}).

Devuelves máximo 9 insights distribuidos en 3 categorías:
  · **3 FORECAST**: predicciones cuantitativas con datos concretos
    (ej. "Sprint terminará 5 días antes según velocity 26 SP/sprint",
    "EAC actualizado USD 920k vs BAC USD 1.2M con CPI 1.04",
    "Milestone go-live alcanzable +2 semanas si se aplica X")
  · **3 RECOMMENDATION**: acciones concretas que mejorarían el proyecto
    (ej. "Re-asignar HU-3.2 de Erick a Edwin · Erick saturado al 120%",
    "Cortar scope de SuccessFactors PG según CR pendiente",
    "Agendar spike de timbrado CFDI ANTES de sprint 3")
  · **3 ANOMALY**: alertas detectadas (estancamientos, outliers, escalations)
    (ej. "5 tareas IN_PROGRESS sin avance >3 días",
    "SP estimación de tsk-3.4 (13 SP) es outlier vs avg 5 SP",
    "Risk de localización CFDI sin owner asignado")

Reglas
──────
1. Cada \`title\` corto (5-12 palabras) y accionable
2. Cada \`body\` con 2-4 frases con NÚMEROS REALES del contexto
3. \`severity\`:
   · HIGH = requiere acción esta semana
   · MEDIUM = a planear próximo sprint
   · LOW = informativo
4. \`actionType\`:
   · create_risk = el insight identifica un riesgo nuevo
   · create_improvement = el insight sugiere una mejora cross-sprint
   · create_task = el insight es trabajo concreto a hacer
   · none = informativo (no hay acción mecanizable)
5. Si \`actionType !== 'none'\`, llena \`actionPayload\` con datos útiles:
   - taskMnemonic (si la insight ata a una task específica)
   - probability/impact (1-5) si es create_risk
   - mitigation (si es create_risk)
   - dueDate (ISO YYYY-MM-DD) si es create_task

🚫 **DEDUPE OBLIGATORIO**: el contexto incluye \`existingInsights\` con
los insights YA generados (status NEW · APPLIED · DISMISSED). NO repitas
insights cuyo título sea similar (compare lowercase). Si todos los temas
relevantes ya están cubiertos, devuelve menos insights (incluso 0 si no
hay nada nuevo · prioriza calidad sobre cantidad).`,
      prompt: `Datos del proyecto:\n${JSON.stringify(ctx, null, 2)}`,
    })
    report = result.object
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[BRAIN_AI] Insights LLM fallback:', reason)
    report = buildHeuristicInsights(ctx)
  }

  // Persistir en BD
  for (const it of report.insights) {
    try {
      await prisma.brainInsight.create({
        data: {
          projectId: input.projectId,
          kind: it.kind,
          title: it.title.slice(0, 200),
          body: it.body.slice(0, 1000),
          severity: it.severity,
          relatedAction:
            it.actionType !== 'none'
              ? ({ type: it.actionType, payload: it.actionPayload ?? {} } as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        },
      })
    } catch (err) {
      console.warn('[BRAIN_AI] Insight persist failed:', err)
    }
  }

  revalidatePath('/brain')
  return report
}

// ────────────────────── Heuristic fallback ──────────────────────

interface InsightCtx {
  now: string
  project: { name: string; cpi: number | null; spi: number | null }
  taskSummary: {
    total: number
    todo: number
    inProgress: number
    review: number
    done: number
    spPending: number
  }
  sprints: Array<{ status: string; capacity: number | null; velocityActual: number | null }>
  existingInsights: Array<{ title: string }>
}

function buildHeuristicInsights(ctx: InsightCtx): InsightsReport {
  const existing = new Set(ctx.existingInsights.map((i) => i.title.toLowerCase()))
  const insights: InsightItem[] = []
  const seen = new Set<string>()

  const push = (it: InsightItem) => {
    const key = it.title.toLowerCase()
    if (existing.has(key) || seen.has(key)) return
    seen.add(key)
    insights.push(it)
  }

  // FORECAST: SP burndown
  const completedSprints = ctx.sprints.filter(
    (s) => s.status === 'COMPLETED' && s.velocityActual,
  )
  const avgVelocity =
    completedSprints.length > 0
      ? Math.round(
          completedSprints.reduce((acc, s) => acc + (s.velocityActual ?? 0), 0) /
            completedSprints.length,
        )
      : null

  if (avgVelocity && ctx.taskSummary.spPending > 0) {
    const sprintsToDone = Math.ceil(ctx.taskSummary.spPending / avgVelocity)
    push({
      kind: 'FORECAST',
      title: `Backlog terminará en ~${sprintsToDone} sprints`,
      body: `Quedan ${ctx.taskSummary.spPending} SP pendientes y la velocity histórica es ${avgVelocity} SP/sprint (promedio de ${completedSprints.length} sprints cerrados). Estimación lineal: ${sprintsToDone} sprints adicionales.`,
      severity: sprintsToDone > 6 ? 'HIGH' : 'MEDIUM',
      actionType: 'none',
    })
  }

  // FORECAST: CPI/SPI extrapolación
  if (ctx.project.cpi !== null && ctx.project.cpi < 0.95) {
    push({
      kind: 'FORECAST',
      title: `EAC excede BAC con CPI ${ctx.project.cpi.toFixed(2)}`,
      body: `Performance index actual ${ctx.project.cpi.toFixed(2)} indica que el proyecto está sobre-gastado. Si la tendencia continúa, el EAC superará el BAC original.`,
      severity: 'HIGH',
      actionType: 'create_risk',
      actionPayload: { probability: 4, impact: 4, mitigation: 'Revisar baseline + plan de recuperación con sponsor.' },
    })
  }

  // ANOMALY: tareas IN_PROGRESS estancadas
  if (ctx.taskSummary.inProgress > 5) {
    push({
      kind: 'ANOMALY',
      title: `${ctx.taskSummary.inProgress} tareas IN_PROGRESS · WIP alto`,
      body: `Tener ${ctx.taskSummary.inProgress} tareas en progreso simultáneamente sugiere falta de focus. Recomendación Scrum: limitar WIP a ≤ N (donde N = team size).`,
      severity: 'MEDIUM',
      actionType: 'create_improvement',
    })
  }

  // RECOMMENDATION: TODOs grandes
  if (ctx.taskSummary.todo > ctx.taskSummary.done && ctx.taskSummary.total > 10) {
    push({
      kind: 'RECOMMENDATION',
      title: 'Priorizar Sprint Planning · backlog mayor que entregado',
      body: `Hay ${ctx.taskSummary.todo} TODO vs ${ctx.taskSummary.done} DONE. Considera un sprint planning más agresivo o re-priorizar el backlog para acelerar value delivery.`,
      severity: 'MEDIUM',
      actionType: 'create_improvement',
    })
  }

  // Si no hay nada
  if (insights.length === 0) {
    push({
      kind: 'FORECAST',
      title: 'Sin insights nuevos detectados',
      body: 'El proyecto está en estado saludable o todos los insights relevantes ya están registrados. Mantén la cadencia de daily standups y monitoreo semanal.',
      severity: 'LOW',
      actionType: 'none',
    })
  }

  return {
    generatedAt: ctx.now,
    projectName: ctx.project.name,
    insights,
  }
}

// ────────────────────── List insights ──────────────────────

export async function listProjectInsights(input: {
  projectId: string
  status?: 'NEW' | 'APPLIED' | 'DISMISSED' | 'ALL'
}) {
  if (!input?.projectId)
    throw new Error('[BRAIN_AI] projectId requerido')
  return prisma.brainInsight.findMany({
    where: {
      projectId: input.projectId,
      status:
        input.status && input.status !== 'ALL' ? input.status : { not: 'DISMISSED' },
    },
    orderBy: [
      { status: 'asc' }, // NEW antes que APPLIED
      { severity: 'desc' },
      { createdAt: 'desc' },
    ],
  })
}

// ────────────────────── Apply / Dismiss ──────────────────────

export async function applyInsight(
  input: ApplyInsightInput,
): Promise<ApplyInsightResult> {
  const insight = await prisma.brainInsight.findUnique({
    where: { id: input.insightId },
    select: {
      id: true,
      projectId: true,
      title: true,
      body: true,
      severity: true,
      relatedAction: true,
      status: true,
    },
  })
  if (!insight) throw new Error('[BRAIN_AI] insight no existe')
  if (insight.status !== 'NEW')
    throw new Error('[BRAIN_AI] insight ya fue procesado')

  let createdEntityId: string | undefined
  let createdEntityKind: 'risk' | 'improvement' | 'task' | undefined

  const action = insight.relatedAction as
    | { type: string; payload?: Record<string, unknown> }
    | null

  if (action?.type === 'create_risk') {
    const payload = action.payload ?? {}
    const taskMnemonic = typeof payload.taskMnemonic === 'string' ? payload.taskMnemonic : null
    let taskId: string | null = null
    if (taskMnemonic) {
      const t = await prisma.task.findFirst({
        where: {
          projectId: insight.projectId,
          mnemonic: taskMnemonic,
          archivedAt: null,
        },
        select: { id: true },
      })
      taskId = t?.id ?? null
    }
    const clamp = (v: unknown, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, Math.round(typeof v === 'number' ? v : 3)))
    const risk = await prisma.risk.create({
      data: {
        projectId: insight.projectId,
        taskId,
        title: insight.title.slice(0, 200),
        description: insight.body.slice(0, 500),
        probability: clamp(payload.probability, 1, 5),
        impact: clamp(payload.impact, 1, 5),
        mitigation:
          typeof payload.mitigation === 'string'
            ? payload.mitigation.slice(0, 500)
            : insight.body.slice(0, 500),
        status: 'OPEN',
      },
      select: { id: true },
    })
    createdEntityId = risk.id
    createdEntityKind = 'risk'
  } else if (action?.type === 'create_improvement') {
    const imp = await prisma.improvementItem.create({
      data: {
        projectId: insight.projectId,
        title: insight.title.slice(0, 200),
        description: insight.body.slice(0, 500),
        status: 'OPEN',
      },
      select: { id: true },
    })
    createdEntityId = imp.id
    createdEntityKind = 'improvement'
  } else if (action?.type === 'create_task') {
    const payload = action.payload ?? {}
    const due = typeof payload.dueDate === 'string' ? new Date(payload.dueDate) : null
    const task = await prisma.task.create({
      data: {
        projectId: insight.projectId,
        title: insight.title.slice(0, 200),
        description: insight.body.slice(0, 500),
        status: 'TODO',
        type: 'PMI_TASK',
        priority:
          insight.severity === 'HIGH'
            ? 'HIGH'
            : insight.severity === 'MEDIUM'
              ? 'MEDIUM'
              : 'LOW',
        endDate: due && !Number.isNaN(due.getTime()) ? due : null,
      },
      select: { id: true },
    })
    createdEntityId = task.id
    createdEntityKind = 'task'
  }

  await prisma.brainInsight.update({
    where: { id: input.insightId },
    data: { status: 'APPLIED', appliedAt: new Date() },
  })

  revalidatePath('/brain')
  return {
    insightId: input.insightId,
    status: 'APPLIED',
    createdEntityId,
    createdEntityKind,
  }
}

export async function dismissInsight(
  input: ApplyInsightInput,
): Promise<ApplyInsightResult> {
  const insight = await prisma.brainInsight.findUnique({
    where: { id: input.insightId },
    select: { id: true, status: true },
  })
  if (!insight) throw new Error('[BRAIN_AI] insight no existe')
  await prisma.brainInsight.update({
    where: { id: input.insightId },
    data: { status: 'DISMISSED', dismissedAt: new Date() },
  })
  revalidatePath('/brain')
  return { insightId: input.insightId, status: 'DISMISSED' }
}
