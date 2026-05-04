'use server'

/**
 * Ola P5 · Equipo P5-4 · AI Insights — Server Actions.
 *
 * Orquesta las heurísticas locales (`src/lib/ai/*`) sobre los datos del
 * proyecto y persiste los resultados en `TaskInsight`. Sin LLM externo:
 *   - `runProjectInsights(projectId)`:  corre las 3 heurísticas (categorización,
 *     riesgo de retraso y next-actions) y persiste/actualiza la tabla.
 *   - `getInsightsForTask(taskId)`:     últimos insights por kind para una task.
 *   - `getProjectRiskOverview(...)`:    top tasks de riesgo a nivel proyecto.
 *   - `dismissInsight(insightId)`:      soft-delete (`dismissedAt`).
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle`.
 *   - Validación zod del input.
 *   - `revalidatePath('/insights')` tras mutaciones.
 *   - Determinismo: el `now` se inyecta dentro del action (única fuente
 *     de "tiempo") para que cualquier llamada repetida con la misma BD
 *     produzca insights consistentes en una corrida.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  categorizeTask,
  predictDelayRisk,
  suggestNextActions,
  type CategorizationResult,
  type NextAction,
  type RiskAssigneeHistory,
  type RiskResult,
  type RiskTaskInput,
  type SuggestProjectInput,
  type SuggestTaskInput,
} from '@/lib/ai'

// ─────────────────────────── Errores tipados ───────────────────────────

export type InsightErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'

function actionError(code: InsightErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas ───────────────────────────────────

const projectIdSchema = z.string().min(1, 'projectId es obligatorio')
const taskIdSchema = z.string().min(1, 'taskId es obligatorio')
const insightIdSchema = z.string().min(1, 'insightId es obligatorio')

// ─────────────────────────── Tipos serializados ────────────────────────

export type SerializedInsight = {
  id: string
  taskId: string
  kind: 'CATEGORIZATION' | 'DELAY_RISK' | 'NEXT_ACTION'
  score: number
  payload: unknown
  dismissedAt: string | null
  createdAt: string
}

export type RiskOverviewItem = {
  taskId: string
  taskTitle: string
  projectId: string
  projectName: string
  score: number
  level: 'low' | 'medium' | 'high'
  factors: string[]
}

// ─────────────────────────── Helpers ───────────────────────────────────

/**
 * Calcula el historial de "entregas tarde" del assignee. Considera
 * tareas DONE con `endDate < updatedAt` como "tarde" (proxy: el cierre
 * llegó después de la fecha planeada). Determinista contra un snapshot
 * de BD.
 */
async function getAssigneeHistory(
  assigneeId: string | null,
): Promise<RiskAssigneeHistory | null> {
  if (!assigneeId) return null
  const completed = await prisma.task.findMany({
    where: { assigneeId, status: 'DONE' },
    select: { endDate: true, updatedAt: true },
  })
  if (completed.length === 0) return { totalCompleted: 0, totalLate: 0 }
  let totalLate = 0
  for (const t of completed) {
    if (t.endDate && t.updatedAt && t.endDate.getTime() < t.updatedAt.getTime()) {
      totalLate += 1
    }
  }
  return { totalCompleted: completed.length, totalLate }
}

/**
 * Adapta una task de Prisma al shape esperado por `predictDelayRisk`.
 * `estimatedHours` se deriva de `plannedValue` cuando no hay un campo
 * directo (proxy razonable: PV en horas equivalentes).
 */
function toRiskTaskInput(
  task: {
    id: string
    status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
    progress: number
    startDate: Date | null
    endDate: Date | null
    plannedValue: number | null
    assigneeId: string | null
    predecessors: Array<{
      predecessor: { id: string; status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' }
    }>
  },
): RiskTaskInput {
  return {
    id: task.id,
    status: task.status,
    progress: task.progress ?? 0,
    startDate: task.startDate,
    endDate: task.endDate,
    estimatedHours: task.plannedValue ?? null,
    assigneeId: task.assigneeId,
    predecessors: task.predecessors.map((p) => ({
      id: p.predecessor.id,
      status: p.predecessor.status,
    })),
  }
}

function toSuggestTaskInput(task: {
  id: string
  title: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
  progress: number
  assigneeId: string | null
  endDate: Date | null
  updatedAt: Date
}): SuggestTaskInput {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    progress: task.progress ?? 0,
    assigneeId: task.assigneeId,
    endDate: task.endDate,
    updatedAt: task.updatedAt,
    inCriticalPath: false, // CPM enrichment lo agrega upstream cuando esté disponible
    baselineDriftDays: null,
  }
}

/**
 * Resuelve `mentionedEmails` a `userId` válidos. Devuelve mapa email→userId
 * sólo para los emails que existen en BD.
 */
async function resolveEmailsToUserIds(
  emails: string[],
): Promise<Record<string, string>> {
  if (emails.length === 0) return {}
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  })
  const map: Record<string, string> = {}
  for (const u of users) {
    map[u.email.toLowerCase()] = u.id
  }
  return map
}

// ─────────────────────────── Actions públicas ──────────────────────────

/**
 * Corre las tres heurísticas sobre todas las tareas no-archivadas del
 * proyecto y persiste los insights resultantes (uno por (task, kind)).
 *
 * Estrategia de upsert simple: borramos los insights vigentes (no
 * dismissed) del proyecto y reinsertamos. Mantenemos los `dismissedAt`
 * para no resucitar sugerencias que el usuario ya rechazó: cuando una
 * heurística vuelve a generar el mismo `kind` para la misma task con
 * `dismissedAt`, NO sobreescribimos.
 */
export async function runProjectInsights(projectId: string): Promise<{
  generated: number
  skipped: number
  riskHigh: number
}> {
  const id = projectIdSchema.parse(projectId)

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      tasks: {
        where: { archivedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          status: true,
          progress: true,
          startDate: true,
          endDate: true,
          assigneeId: true,
          plannedValue: true,
          updatedAt: true,
          predecessors: {
            select: {
              predecessor: { select: { id: true, status: true } },
            },
          },
        },
      },
      sprints: {
        select: { id: true, name: true, status: true, capacity: true },
      },
    },
  })
  if (!project) actionError('NOT_FOUND', `Proyecto ${id} no encontrado`)

  const now = new Date()
  let generated = 0
  let skipped = 0
  let riskHigh = 0

  // Pre-cargamos historial de assignees únicos para minimizar queries.
  const assigneeIds = Array.from(
    new Set(project.tasks.map((t) => t.assigneeId).filter((v): v is string => !!v)),
  )
  const histories: Record<string, RiskAssigneeHistory> = {}
  for (const aId of assigneeIds) {
    const h = await getAssigneeHistory(aId)
    if (h) histories[aId] = h
  }

  // Insights ya descartados (soft-delete) para NO re-crear. Los
  // identificamos por (taskId, kind).
  const dismissed = await prisma.taskInsight.findMany({
    where: {
      task: { projectId: id },
      dismissedAt: { not: null },
    },
    select: { taskId: true, kind: true },
  })
  const dismissedKey = new Set(
    dismissed.map((d) => `${d.taskId}:${d.kind}`),
  )

  // 1. Limpiamos los activos previos del proyecto (los re-creamos).
  await prisma.taskInsight.deleteMany({
    where: {
      task: { projectId: id },
      dismissedAt: null,
    },
  })

  for (const task of project.tasks) {
    // Categorización
    const categorization: CategorizationResult = categorizeTask(
      task.title,
      task.description,
    )
    if (categorization.confidence > 0.2) {
      const key = `${task.id}:CATEGORIZATION`
      if (!dismissedKey.has(key)) {
        const emailMap = await resolveEmailsToUserIds(categorization.mentionedEmails)
        const payload = {
          suggestedCategory: categorization.suggestedCategory,
          suggestedTaskType: categorization.suggestedTaskType,
          reasoning: categorization.reasoning,
          mentionedEmails: categorization.mentionedEmails,
          resolvedAssignees: emailMap,
          suggestedTags: categorization.suggestedTags,
        }
        await prisma.taskInsight.create({
          data: {
            taskId: task.id,
            kind: 'CATEGORIZATION',
            score: categorization.confidence,
            payload: payload as Prisma.InputJsonValue,
          },
        })
        generated += 1
      } else {
        skipped += 1
      }
    }

    // Riesgo de retraso
    const risk: RiskResult = predictDelayRisk(
      toRiskTaskInput(task),
      task.assigneeId ? histories[task.assigneeId] ?? null : null,
      now,
    )
    const key = `${task.id}:DELAY_RISK`
    if (!dismissedKey.has(key)) {
      await prisma.taskInsight.create({
        data: {
          taskId: task.id,
          kind: 'DELAY_RISK',
          score: risk.score,
          payload: {
            level: risk.level,
            factors: risk.factors,
          } as Prisma.InputJsonValue,
        },
      })
      generated += 1
      if (risk.level === 'high') riskHigh += 1
    } else {
      skipped += 1
    }
  }

  // 2. Next actions a nivel proyecto (anclamos al primer task del proyecto
  //    como "task host" del insight para no romper el FK required).
  if (project.tasks.length > 0) {
    const projectInput: SuggestProjectInput = {
      id: project.id,
      name: project.name,
      tasks: project.tasks.map(toSuggestTaskInput),
      sprints: project.sprints,
    }
    const actions: NextAction[] = suggestNextActions(projectInput, now)
    const hostTaskId = project.tasks[0].id
    for (const action of actions) {
      const key = `${hostTaskId}:NEXT_ACTION:${action.key}`
      if (!dismissedKey.has(key)) {
        await prisma.taskInsight.create({
          data: {
            taskId: hostTaskId,
            kind: 'NEXT_ACTION',
            score: action.severity,
            payload: {
              key: action.key,
              message: action.message,
              count: action.count,
              projectId: project.id,
              projectName: project.name,
            } as Prisma.InputJsonValue,
          },
        })
        generated += 1
      } else {
        skipped += 1
      }
    }
  }

  revalidatePath('/insights')
  revalidatePath(`/projects/${id}`)
  return { generated, skipped, riskHigh }
}

/**
 * Devuelve los últimos insights activos para una task, ordenados por
 * createdAt desc, agrupados por kind (un insight por kind es lo
 * habitual tras `runProjectInsights`).
 */
export async function getInsightsForTask(taskId: string): Promise<SerializedInsight[]> {
  const id = taskIdSchema.parse(taskId)
  const rows = await prisma.taskInsight.findMany({
    where: { taskId: id, dismissedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(serializeInsight)
}

/**
 * Top N tareas con riesgo alto a nivel global (todos los proyectos no
 * archivados). Útil para el dashboard `/insights`.
 */
export async function getProjectRiskOverview(
  limit = 10,
): Promise<RiskOverviewItem[]> {
  const cap = Math.max(1, Math.min(50, Math.floor(limit)))
  const rows = await prisma.taskInsight.findMany({
    where: {
      kind: 'DELAY_RISK',
      dismissedAt: null,
    },
    orderBy: { score: 'desc' },
    take: cap,
    select: {
      score: true,
      payload: true,
      task: {
        select: {
          id: true,
          title: true,
          project: { select: { id: true, name: true } },
        },
      },
    },
  })
  return rows.map((row) => {
    const payload = (row.payload ?? {}) as { level?: string; factors?: string[] }
    const level: 'low' | 'medium' | 'high' =
      payload.level === 'high' || payload.level === 'medium' || payload.level === 'low'
        ? payload.level
        : 'low'
    return {
      taskId: row.task.id,
      taskTitle: row.task.title,
      projectId: row.task.project.id,
      projectName: row.task.project.name,
      score: row.score,
      level,
      factors: Array.isArray(payload.factors) ? payload.factors : [],
    }
  })
}

/**
 * Marca un insight como descartado (soft-delete). Idempotente.
 */
export async function dismissInsight(insightId: string): Promise<void> {
  const id = insightIdSchema.parse(insightId)
  const found = await prisma.taskInsight.findUnique({ where: { id } })
  if (!found) actionError('NOT_FOUND', `Insight ${id} no encontrado`)
  if (found.dismissedAt) return
  await prisma.taskInsight.update({
    where: { id },
    data: { dismissedAt: new Date() },
  })
  revalidatePath('/insights')
}

/**
 * Resumen por proyecto: count de insights por kind. Útil para el
 * dashboard sin tener que cargar la lista completa.
 */
export async function getProjectInsightSummary(projectId: string): Promise<{
  projectId: string
  categorization: number
  delayRisk: number
  nextAction: number
  highRisk: number
}> {
  const id = projectIdSchema.parse(projectId)
  const rows = await prisma.taskInsight.findMany({
    where: {
      task: { projectId: id },
      dismissedAt: null,
    },
    select: { kind: true, payload: true },
  })
  let categorization = 0
  let delayRisk = 0
  let nextAction = 0
  let highRisk = 0
  for (const r of rows) {
    if (r.kind === 'CATEGORIZATION') categorization += 1
    if (r.kind === 'DELAY_RISK') {
      delayRisk += 1
      const payload = (r.payload ?? {}) as { level?: string }
      if (payload.level === 'high') highRisk += 1
    }
    if (r.kind === 'NEXT_ACTION') nextAction += 1
  }
  return { projectId: id, categorization, delayRisk, nextAction, highRisk }
}

// ─────────────────────────── Serialización ─────────────────────────────

function serializeInsight(row: {
  id: string
  taskId: string
  kind: 'CATEGORIZATION' | 'DELAY_RISK' | 'NEXT_ACTION'
  score: number
  payload: unknown
  dismissedAt: Date | null
  createdAt: Date
}): SerializedInsight {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    score: row.score,
    payload: row.payload,
    dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}
