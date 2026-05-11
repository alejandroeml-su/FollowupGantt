'use server'

import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import prisma from '@/lib/prisma'
import { getServerLocale } from '@/lib/i18n/server'
import {
  StandupReportSchema,
  RiskReportSchema,
  type StandupReport,
  type RiskReport,
  type RegisterRiskInput,
  type RegisterRiskResult,
  type BrainProjectOption,
} from './pm-types'

/**
 * Wave P20 (i18n) — System prompt para Standup en es/en. Conserva
 * mismas reglas, traduce el wording que aparece en el output.
 */
function buildStandupSystemPrompt(locale: 'es' | 'en'): string {
  if (locale === 'en') {
    return `You are Avante Brain, the AI Project Manager assistant for FollowupGantt.

You produce executive stand-ups in English from the system's real activity over the last 24h.

Rules:
- Be concise. \`summary\` must not exceed 2 sentences.
- Only include users with real activity (do not invent names).
- "Completed today" = TaskHistory entries where field='status' and newValue='DONE'.
- "In progress" = tasks with status=IN_PROGRESS assigned to the user.
- If there is no activity, be honest: "No changes were recorded in the last 24h."
- Identify real blockers: IN_PROGRESS tasks with no progress (progress=0) or overdue high-priority tasks.
- Do not invent projects or data.`
  }
  return `Eres Avante Brain, asistente del Project Manager AI de FollowupGantt.

Generas stand-ups ejecutivos en español a partir de la actividad real de las últimas 24h del sistema.

Reglas:
- Sé conciso. El \`summary\` no debe pasar de 2 frases.
- Sólo incluye usuarios con actividad real (no inventes nombres).
- "Completado hoy" = entradas de TaskHistory donde field='status' y newValue='DONE'.
- "En progreso" = tareas con status=IN_PROGRESS asignadas al usuario.
- Si no hay actividad, sé honesto: "No hubo cambios registrados en las últimas 24h."
- Identifica blockers reales: tareas IN_PROGRESS sin progreso (progress=0) o atrasadas con prioridad alta.
- No inventes proyectos ni datos.`
}

/**
 * Wave P20 (i18n) — System prompt para Risk Analysis en es/en.
 */
function buildRiskSystemPrompt(
  locale: 'es' | 'en',
  ctx: { project: { name: string; methodology: string } },
): string {
  if (locale === 'en') {
    return `You are Avante Brain, a PMI/Agile/ITIL project management specialist for FollowupGantt.

You analyze the **${ctx.project.name}** project (methodology ${ctx.project.methodology}) and return
actionable alerts in English, calibrated to the PMBOK 5×5 matrix.

Rules:
- Return at most 5 alerts, ranked by severity (HIGH > MEDIUM > LOW).
- Each alert must include \`rationale\` with concrete data (days late, % progress, numeric SPI).
- Each alert MUST include \`probability\` (1-5), \`impact\` (1-5) and \`triggerDelayDays\` (extra
  schedule days if the risk materializes, 0 if there is no time impact).
- 5×5 matrix calibration:
  · prob 1-2 = unlikely; 3 = possible; 4-5 = nearly certain
  · impact 1-2 = nuisance; 3 = affects release; 4 = affects milestone; 5 = catastrophic
- \`severity\` derives from the product P×I:
  · HIGH if P×I >= 12 · MEDIUM if 6-11 · LOW if <= 5
- \`overallStatus\`:
  · HEALTHY = no critical delays and SPI/CPI >= 0.95
  · AT_RISK = 1-3 non-critical delays or SPI 0.85-0.94
  · CRITICAL = delays on CRITICAL tasks or SPI < 0.85
- Alert \`type\`:
  · OVERDUE: task passed endDate and is not DONE
  · CRITICAL_TASK: task with priority=CRITICAL at risk
  · EVM_DEVIATION: SPI or CPI below 0.9
  · DEPENDENCY_VIOLATION: predecessor not finished blocking successor
  · STALE: IN_PROGRESS task with no progress (progress=0)
- \`taskMnemonic\` MUST be the exact mnemonic of the most-related task (e.g. "p9-3"),
  or empty/omitted if the alert is project-wide (e.g. EVM_DEVIATION).
- \`suggestedAction\` must be a concrete actionable mitigation that goes directly to the
  \`Risk.mitigation\` field of the Risk Register: "Reassign to X", "Escalate to sponsor",
  "Trim scope", not generic.

DEDUPE REQUIRED: the \`existingRisks\` context field contains risks ALREADY REGISTERED
in this project's Risk Register. Do NOT suggest alerts that conceptually duplicate
an already-registered risk (compare title + taskMnemonic). If every relevant problem
is already registered, return a single LOW informational alert.

- If everything is healthy and there is nothing NEW to suggest, return a single
  informational alert of severity=LOW saying so explicitly.`
  }
  return `Eres Avante Brain, especialista en gestión de proyectos PMI/Agile/ITIL de FollowupGantt.

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

DEDUPE OBLIGATORIO: el campo \`existingRisks\` del contexto contiene los riesgos
YA REGISTRADOS en el Risk Register de este proyecto. NO sugieras alertas que dupliquen
en concepto un riesgo ya registrado (compara title + taskMnemonic). Si todos los
problemas relevantes ya están registrados, devuelve un solo alert LOW informativo.

- Si todo está saludable y no hay riesgos NUEVOS para sugerir, devuelve un único alert
  informativo de severity=LOW indicándolo expresamente.`
}

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
  // Wave P20 — Locale-aware prompts (es/en).
  const locale = await getServerLocale()
  const promptLine =
    locale === 'en'
      ? `Current date: ${today()}\n\nLast 24h activity:`
      : `Fecha actual: ${today()}\n\nActividad de las últimas 24h:`
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: StandupReportSchema,
    system: buildStandupSystemPrompt(locale),
    prompt: `${promptLine}\n${JSON.stringify(ctx, null, 2)}`,
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
    // Wave P20 — Locale-aware prompts (es/en).
    const locale = await getServerLocale()
    const promptLine =
      locale === 'en'
        ? `Project data to analyze:`
        : `Datos del proyecto a analizar:`
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: RiskReportSchema,
      system: buildRiskSystemPrompt(locale, { project: ctx.project }),
      prompt: `${promptLine}\n${JSON.stringify(ctx, null, 2)}`,
    })
    object = result.object
  } catch (err) {
    // Wave P14c follow-up — Si el LLM falla (rate limit, schema rejection,
    // output inválido, etc.) caemos a fallback heurístico calculado desde
    // los datos reales del contexto. Garantiza que la feature funciona
    // aunque el provider tenga problemas. El usuario verá las alertas
    // marcadas con `type` lógico, sin la "narrativa" enriquecida del LLM.
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[BRAIN_AI] LLM fallback heuristic activated:', reason)
    object = buildHeuristicRiskReport(ctx)
  }
  return object
}

// ─── Wave P14c follow-up · Heuristic fallback ───────────────────────

interface RiskCtx {
  now: string
  project: { name: string; spi: number | null; cpi: number | null } | null
  overdue: Array<{
    mnemonic: string | null
    title: string
    priority: string
    progress: number
    daysOverdue: number | null
  }>
  criticalOpen: Array<{
    mnemonic: string | null
    title: string
    progress: number
  }>
  existingRisks: Array<{ title: string; taskMnemonic: string | null }>
}

function buildHeuristicRiskReport(ctx: RiskCtx): RiskReport {
  const existingTitles = new Set(
    ctx.existingRisks.map((r) => r.title.toLowerCase()),
  )

  const alerts: RiskReport['alerts'] = []

  // Overdue tasks
  for (const t of ctx.overdue.slice(0, 3)) {
    const title = `Tarea atrasada: ${t.title}`
    if (existingTitles.has(title.toLowerCase())) continue
    const days = t.daysOverdue ?? 0
    const priority = t.priority === 'CRITICAL' ? 5 : t.priority === 'HIGH' ? 4 : 3
    alerts.push({
      severity: priority >= 4 ? 'HIGH' : 'MEDIUM',
      type: 'OVERDUE',
      taskMnemonic: t.mnemonic ?? undefined,
      title: title.slice(0, 100),
      rationale: `${days} días atrasada · ${t.progress}% avance · prioridad ${t.priority}.`,
      suggestedAction:
        days > 7
          ? 'Escalar a sponsor + reasignar a recurso disponible.'
          : 'Reasignar o re-priorizar para destrabar el deadline.',
      probability: 4,
      impact: priority,
      triggerDelayDays: Math.min(days * 2, 60),
    })
  }

  // Critical tasks at risk
  for (const t of ctx.criticalOpen.slice(0, 2)) {
    const title = `Crítica sin avance: ${t.title}`
    if (existingTitles.has(title.toLowerCase())) continue
    if (t.progress > 30) continue // solo si está estancada
    alerts.push({
      severity: 'HIGH',
      type: 'CRITICAL_TASK',
      taskMnemonic: t.mnemonic ?? undefined,
      title: title.slice(0, 100),
      rationale: `Tarea CRITICAL con ${t.progress}% de avance.`,
      suggestedAction:
        'Asignar pair-programming + revisión de bloqueos en próximo daily.',
      probability: 4,
      impact: 5,
      triggerDelayDays: 14,
    })
  }

  // EVM deviation
  const spi = ctx.project?.spi ?? 1
  const cpi = ctx.project?.cpi ?? 1
  if (spi < 0.9 || cpi < 0.9) {
    const title = `Desviación EVM · SPI ${spi.toFixed(2)} · CPI ${cpi.toFixed(2)}`
    if (!existingTitles.has(title.toLowerCase())) {
      alerts.push({
        severity: spi < 0.85 || cpi < 0.85 ? 'HIGH' : 'MEDIUM',
        type: 'EVM_DEVIATION',
        taskMnemonic: undefined,
        title: title.slice(0, 100),
        rationale: `Performance index del proyecto fuera del rango saludable (>= 0.95).`,
        suggestedAction:
          'Revisar baseline + ajustar EAC + escalar a sponsor con plan de recuperación.',
        probability: 4,
        impact: 4,
        triggerDelayDays: 21,
      })
    }
  }

  // Si no hay alertas, devolver un alert informativo
  if (alerts.length === 0) {
    alerts.push({
      severity: 'LOW',
      type: 'STALE',
      taskMnemonic: undefined,
      title: 'Sin riesgos nuevos detectados',
      rationale:
        'No se detectaron riesgos adicionales. Todos los conocidos ya están registrados o el proyecto está saludable.',
      suggestedAction: 'Mantener cadencia de daily standups y monitoreo semanal.',
      probability: 1,
      impact: 1,
      triggerDelayDays: 0,
    })
  }

  // Determinar overallStatus desde los datos
  let overallStatus: RiskReport['overallStatus'] = 'HEALTHY'
  if (
    alerts.some((a) => a.severity === 'HIGH') ||
    spi < 0.85 ||
    cpi < 0.85
  ) {
    overallStatus = 'CRITICAL'
  } else if (
    alerts.some((a) => a.severity === 'MEDIUM') ||
    ctx.overdue.length > 0
  ) {
    overallStatus = 'AT_RISK'
  }

  return {
    date: ctx.now,
    overallStatus,
    headline: `Análisis heurístico (fallback): ${ctx.overdue.length} atrasadas · ${ctx.criticalOpen.length} críticas abiertas · SPI ${spi.toFixed(2)}.`,
    alerts: alerts.slice(0, 5),
  }
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

  // Wave P14c — Clamp defensivo: el schema zod no puede usar min/max
  // (Anthropic structured output los rechaza), así que el LLM podría
  // devolver valores fuera de rango. Aquí los normalizamos antes de
  // persistir para mantener integridad de la matriz 5×5.
  const clampInt = (val: number, lo: number, hi: number): number =>
    Math.max(lo, Math.min(hi, Math.round(val)))

  const created = await prisma.risk.create({
    data: {
      projectId: input.projectId,
      taskId,
      title: input.alert.title.trim().slice(0, 200),
      description: input.alert.rationale.slice(0, 500),
      probability: clampInt(input.alert.probability, 1, 5),
      impact: clampInt(input.alert.impact, 1, 5),
      mitigation: input.alert.suggestedAction.slice(0, 500),
      triggerDelayDays:
        input.alert.triggerDelayDays > 0
          ? clampInt(input.alert.triggerDelayDays, 0, 180)
          : null,
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
