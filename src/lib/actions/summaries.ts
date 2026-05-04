'use server'

/**
 * Ola P7 · Equipo P7-3 · Server Actions de Resúmenes Ejecutivos
 *
 * Cada action:
 *   1. Auth: `requireProjectAccess` (excepto `generateExecutiveBriefing`,
 *      que requiere PM/admin via reuso de la guard del briefing existente).
 *   2. Carga de datos: reusa actions de P5-3 (`getStatusReport`,
 *      `getPortfolioReport`, `getBaselineSnapshot`) + carga directa de
 *      Prisma para tareas current y riesgos.
 *   3. Genera narrativa con `withFallback(LLM, heurística)`.
 *   4. Cachea con `unstable_cache` y tag `summary:<kind>:<scope>` (TTL 30min).
 *      `bypassCache=true` permite regenerar.
 *
 * Errores tipados:
 *   - [UNAUTHORIZED]      sesión faltante.
 *   - [FORBIDDEN]         sin acceso al proyecto / sin rol PM+.
 *   - [NOT_FOUND]         projectId/baselineId no existe.
 *   - [INVALID_INPUT]     parámetros inválidos.
 */

import { z } from 'zod'
import { unstable_cache, revalidateTag } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { requireUser } from '@/lib/auth/get-current-user'
import { hasAdminRole, ROLE_NAMES } from '@/lib/auth/permissions'
import {
  getStatusReport,
  getPortfolioReport,
} from '@/lib/actions/reports'
import { getBaselineSnapshot } from '@/lib/actions/baselines'

import {
  generateStatusNarrative,
  type StatusNarrativePeriod,
} from '@/lib/ai/summaries/status-narrative'
import { generateExecutiveBriefing } from '@/lib/ai/summaries/executive-briefing'
import {
  generateBaselineDiffSummary,
  type CurrentSnapshotTask,
} from '@/lib/ai/summaries/baseline-diff-summary'
import {
  generateRisksNarrative,
  type DeadlineViolation,
  type RiskItem,
} from '@/lib/ai/summaries/risks-narrative'
import { SUMMARY_CACHE_TTL_SECONDS, type Narrative } from '@/lib/ai/summaries/prompts'

// ─────────────────────────── Errores tipados ───────────────────────────

type SummaryErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'

function actionError(code: SummaryErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schemas ───────────────────────────

const statusInputSchema = z.object({
  projectId: z.string().min(1),
  period: z.enum(['week', 'month']).default('week'),
  bypassCache: z.boolean().default(false),
})

const briefingInputSchema = z.object({
  bypassCache: z.boolean().default(false),
})

const baselineDiffInputSchema = z.object({
  projectId: z.string().min(1),
  baselineId: z.string().min(1),
  bypassCache: z.boolean().default(false),
})

const risksInputSchema = z.object({
  projectId: z.string().min(1),
  scoreThreshold: z.number().min(0).max(1).default(0.6),
  bypassCache: z.boolean().default(false),
})

// ─────────────────────────── Tag helpers ───────────────────────────

function statusTag(projectId: string, period: StatusNarrativePeriod): string {
  return `summary:status:${projectId}:${period}`
}
function briefingTag(): string {
  return 'summary:briefing'
}
function baselineDiffTag(projectId: string, baselineId: string): string {
  return `summary:baseline-diff:${projectId}:${baselineId}`
}
function risksTag(projectId: string): string {
  return `summary:risks:${projectId}`
}

// ─────────────────────────── 1. Status narrative ───────────────────────

export type GenerateStatusNarrativeInput = z.input<typeof statusInputSchema>

export async function generateStatusNarrativeAction(
  input: GenerateStatusNarrativeInput,
): Promise<Narrative> {
  const parsed = statusInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { projectId, period, bypassCache } = parsed.data

  await requireProjectAccess(projectId)

  if (bypassCache) {
    revalidateTag(statusTag(projectId, period), 'max')
  }

  const tag = statusTag(projectId, period)
  return unstable_cache(
    async () => {
      const report = await getStatusReport(projectId)
      return generateStatusNarrative({ report, period }, new Date())
    },
    ['summary-status', projectId, period],
    { tags: [tag], revalidate: SUMMARY_CACHE_TTL_SECONDS },
  )()
}

// ─────────────────────────── 2. Executive briefing ─────────────────────

async function requirePortfolioAccess() {
  const user = await requireUser()
  if (hasAdminRole(user.roles)) return user
  if (user.roles.includes('PM')) return user
  actionError('FORBIDDEN', `Se requiere rol ${ROLE_NAMES.ADMIN} o PM`)
}

export type GenerateExecutiveBriefingInput = z.input<typeof briefingInputSchema>

export async function generateExecutiveBriefingAction(
  input: GenerateExecutiveBriefingInput = {},
): Promise<Narrative> {
  const parsed = briefingInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { bypassCache } = parsed.data

  await requirePortfolioAccess()

  if (bypassCache) {
    revalidateTag(briefingTag(), 'max')
  }

  return unstable_cache(
    async () => {
      const portfolio = await getPortfolioReport()
      return generateExecutiveBriefing({ portfolio }, new Date())
    },
    ['summary-briefing'],
    { tags: [briefingTag()], revalidate: SUMMARY_CACHE_TTL_SECONDS },
  )()
}

// ─────────────────────────── 3. Baseline diff ──────────────────────────

export type GenerateBaselineDiffSummaryInput = z.input<
  typeof baselineDiffInputSchema
>

export async function generateBaselineDiffSummaryAction(
  input: GenerateBaselineDiffSummaryInput,
): Promise<Narrative> {
  const parsed = baselineDiffInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { projectId, baselineId, bypassCache } = parsed.data

  await requireProjectAccess(projectId)

  if (bypassCache) {
    revalidateTag(baselineDiffTag(projectId, baselineId), 'max')
  }

  return unstable_cache(
    async () => {
      const baselineRow = await getBaselineSnapshot(baselineId)
      if (!baselineRow) actionError('NOT_FOUND', `Baseline ${baselineId} no encontrada`)
      if (baselineRow.projectId !== projectId) {
        actionError('NOT_FOUND', 'La baseline no pertenece a este proyecto')
      }
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true },
      })
      if (!project) actionError('NOT_FOUND', `Proyecto ${projectId} no encontrado`)

      const tasks = await prisma.task.findMany({
        where: { projectId, archivedAt: null },
        select: {
          id: true,
          title: true,
          endDate: true,
          plannedValue: true,
          actualCost: true,
          progress: true,
          status: true,
        },
      })

      const current: CurrentSnapshotTask[] = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        plannedEnd: t.endDate ? t.endDate.toISOString() : null,
        plannedValue: t.plannedValue,
        actualCost: t.actualCost,
        progress: t.progress,
        status: t.status,
      }))

      return generateBaselineDiffSummary(
        {
          projectName: project.name,
          baseline: {
            capturedAt: baselineRow.snapshot.capturedAt,
            label: baselineRow.snapshot.label,
            version: baselineRow.version,
            tasks: baselineRow.snapshot.tasks,
          },
          current: {
            asOf: new Date().toISOString(),
            tasks: current,
          },
        },
        new Date(),
      )
    },
    ['summary-baseline-diff', projectId, baselineId],
    {
      tags: [baselineDiffTag(projectId, baselineId)],
      revalidate: SUMMARY_CACHE_TTL_SECONDS,
    },
  )()
}

// ─────────────────────────── 4. Risks narrative ────────────────────────

export type GenerateRisksNarrativeInput = z.input<typeof risksInputSchema>

export async function generateRisksNarrativeAction(
  input: GenerateRisksNarrativeInput,
): Promise<Narrative> {
  const parsed = risksInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { projectId, scoreThreshold, bypassCache } = parsed.data

  await requireProjectAccess(projectId)

  if (bypassCache) {
    revalidateTag(risksTag(projectId), 'max')
  }

  return unstable_cache(
    async () => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true },
      })
      if (!project) actionError('NOT_FOUND', `Proyecto ${projectId} no encontrado`)

      const insights = await prisma.taskInsight.findMany({
        where: {
          kind: 'DELAY_RISK',
          dismissedAt: null,
          score: { gte: scoreThreshold },
          task: { projectId, archivedAt: null },
        },
        orderBy: { score: 'desc' },
        take: 20,
        select: {
          score: true,
          payload: true,
          taskId: true,
          task: { select: { title: true } },
        },
      })

      const risks: RiskItem[] = insights.map((row) => {
        const payload = (row.payload ?? {}) as { level?: string; factors?: string[] }
        const level: 'low' | 'medium' | 'high' =
          payload.level === 'high' || payload.level === 'medium' || payload.level === 'low'
            ? payload.level
            : 'low'
        return {
          taskId: row.taskId,
          taskTitle: row.task.title,
          score: row.score,
          level,
          factors: Array.isArray(payload.factors) ? payload.factors : [],
        }
      })

      // Hard deadline violations (proxy: endDate > hardDeadline o
      // endDate null y hoy > hardDeadline). Sin recargar CPM extendido —
      // el equipo P5-2 usa una function distinta; aquí basta el proxy.
      const now = new Date()
      const deadlineRows = await prisma.task.findMany({
        where: {
          projectId,
          archivedAt: null,
          hardDeadline: { not: null },
        },
        select: {
          id: true,
          title: true,
          hardDeadline: true,
          endDate: true,
        },
      })
      const deadlineViolations: DeadlineViolation[] = []
      for (const t of deadlineRows) {
        if (!t.hardDeadline) continue
        const end = t.endDate ?? now
        const diffMs = end.getTime() - t.hardDeadline.getTime()
        if (diffMs > 0) {
          deadlineViolations.push({
            taskId: t.id,
            taskTitle: t.title,
            hardDeadline: t.hardDeadline.toISOString(),
            endDate: t.endDate ? t.endDate.toISOString() : null,
            daysOver: Math.ceil(diffMs / 86_400_000),
          })
        }
      }
      deadlineViolations.sort((a, b) => b.daysOver - a.daysOver)

      return generateRisksNarrative(
        {
          projectName: project.name,
          risks,
          deadlineViolations,
          scoreThreshold,
        },
        now,
      )
    },
    ['summary-risks', projectId, String(scoreThreshold)],
    { tags: [risksTag(projectId)], revalidate: SUMMARY_CACHE_TTL_SECONDS },
  )()
}
