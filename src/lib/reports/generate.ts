import 'server-only'

/**
 * Wave R5 Extended · US-Reporting-PDF — Generación server-side de PDFs.
 *
 * Punto único de entrada `generateProjectReport({...})` que:
 *   1. Resuelve visibilidad RBAC del proyecto (`resolveProjectVisibility`).
 *   2. Carga los datos relevantes (Project / Task / Risk / Sprint /
 *      Retrospective / EVMSnapshot) con queries shape-tight (sólo lo
 *      que cada template necesita).
 *   3. Renderiza el árbol React con `@react-pdf/renderer` y devuelve
 *      el `Buffer` listo para stream a la respuesta HTTP.
 *
 * Convenciones:
 *   - Errores con prefijo `[CODE] msg` para que el caller (route handler
 *     o action) pueda mapear a status HTTP / mensaje en cliente.
 *   - El bundle de `@react-pdf/renderer` exige Node runtime — el caller
 *     debe declarar `export const runtime = 'nodejs'`.
 *   - No se loguea audit aquí (lo hace el route handler con headers/IP).
 */

import { renderToBuffer } from '@react-pdf/renderer'
import prisma from '@/lib/prisma'
import { resolveProjectVisibility } from '@/lib/auth/visibility'
import type { SessionUser } from '@/lib/auth/session'
import {
  StatusReportPMI,
  type StatusReportPMIData,
} from './templates/StatusReportPMI'
import {
  SprintReviewReport,
  type SprintReviewReportData,
} from './templates/SprintReviewReport'

// ───────────────────────── Tipos públicos ─────────────────────────

export type ProjectReportKind = 'status' | 'sprint-review'

export interface GenerateProjectReportArgs {
  /** Usuario autenticado — usado para RBAC vía `resolveProjectVisibility`. */
  sessionUser: SessionUser & {
    gerenciaId?: string | null
    workspaceId?: string | null
  }
  /** Proyecto destino del reporte. */
  projectId: string
  /** Plantilla a generar. */
  kind: ProjectReportKind
  /** Requerido cuando `kind === 'sprint-review'`. */
  sprintId?: string
}

export interface GenerateProjectReportResult {
  buffer: Buffer
  filename: string
}

// ───────────────────────── Helpers de error ─────────────────────────

function reportError(
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_INPUT',
  detail: string,
): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Carga de datos por template ─────────────────────────

async function loadStatusReportPMI(
  projectId: string,
): Promise<StatusReportPMIData> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true, createdAt: true },
  })
  if (!project) reportError('NOT_FOUND', `Project ${projectId} no existe`)

  // Project sin start/end propio — heurística: min/max sobre Task.
  const [bounds, completedAgg, allAgg, latestEvm, openRisks, upcomingMilestones] =
    await Promise.all([
      prisma.task.aggregate({
        where: { projectId, archivedAt: null },
        _min: { startDate: true, createdAt: true },
        _max: { endDate: true },
      }),
      prisma.task.aggregate({
        where: { projectId, archivedAt: null, status: 'DONE' },
        _count: { _all: true },
      }),
      prisma.task.aggregate({
        where: { projectId, archivedAt: null },
        _count: { _all: true },
      }),
      prisma.eVMSnapshot.findFirst({
        where: { projectId },
        orderBy: { snapshotDate: 'desc' },
        select: {
          plannedValue: true,
          earnedValue: true,
          actualCost: true,
          spi: true,
          cpi: true,
        },
      }),
      prisma.risk.findMany({
        where: {
          projectId,
          status: { in: ['OPEN', 'MITIGATING'] },
        },
        select: {
          title: true,
          probability: true,
          impact: true,
          status: true,
        },
        orderBy: [{ probability: 'desc' }, { impact: 'desc' }],
        take: 5,
      }),
      prisma.task.findMany({
        where: {
          projectId,
          archivedAt: null,
          isMilestone: true,
          status: { not: 'DONE' },
          endDate: { not: null },
        },
        select: { title: true, endDate: true },
        orderBy: { endDate: 'asc' },
        take: 5,
      }),
    ])

  // Tareas atrasadas: endDate < now AND status != DONE. Calculamos `daysLate`
  // server-side para que el template sólo rendere.
  const now = new Date()
  const lateRows = await prisma.task.findMany({
    where: {
      projectId,
      archivedAt: null,
      status: { not: 'DONE' },
      endDate: { lt: now },
    },
    select: { title: true, endDate: true },
    orderBy: { endDate: 'asc' },
    take: 15,
  })

  const completed = completedAgg._count._all
  const total = allAgg._count._all
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100)

  const scheduleDeviation = lateRows.map((t) => ({
    title: t.title,
    endDate: t.endDate ? t.endDate.toISOString() : null,
    daysLate: t.endDate
      ? Math.max(
          0,
          Math.floor((now.getTime() - t.endDate.getTime()) / (1000 * 60 * 60 * 24)),
        )
      : 0,
  }))

  const severityFromScore = (
    score: number,
  ): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' => {
    if (score >= 20) return 'CRITICAL'
    if (score >= 12) return 'HIGH'
    if (score >= 6) return 'MEDIUM'
    return 'LOW'
  }

  return {
    project: {
      id: project!.id,
      name: project!.name,
      status: project!.status,
      progress,
      plannedStart: bounds._min.startDate
        ? bounds._min.startDate.toISOString()
        : null,
      plannedEnd: bounds._max.endDate
        ? bounds._max.endDate.toISOString()
        : null,
      actualStart: bounds._min.createdAt
        ? bounds._min.createdAt.toISOString()
        : project!.createdAt.toISOString(),
      // No tenemos un "actual end" formal. Pasamos el bound max como
      // proyectado para que el template muestre la fecha tope conocida.
      actualEnd: bounds._max.endDate
        ? bounds._max.endDate.toISOString()
        : null,
    },
    evm: latestEvm
      ? {
          pv: Number(latestEvm.plannedValue),
          ev: Number(latestEvm.earnedValue),
          ac: Number(latestEvm.actualCost),
          spi: latestEvm.spi ?? null,
          cpi: latestEvm.cpi ?? null,
        }
      : null,
    topRisks: openRisks.map((r) => ({
      title: r.title,
      severity: severityFromScore(r.probability * r.impact),
      status: r.status,
    })),
    upcomingMilestones: upcomingMilestones.map((m) => ({
      title: m.title,
      endDate: m.endDate ? m.endDate.toISOString() : null,
    })),
    scheduleDeviation,
    generatedAt: new Date().toISOString(),
  }
}

async function loadSprintReviewReport(
  projectId: string,
  sprintId: string,
): Promise<SprintReviewReportData> {
  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, projectId },
    select: {
      id: true,
      name: true,
      goal: true,
      startDate: true,
      endDate: true,
      status: true,
      project: { select: { id: true, name: true } },
    },
  })
  if (!sprint)
    reportError(
      'NOT_FOUND',
      `Sprint ${sprintId} no existe en proyecto ${projectId}`,
    )

  const tasks = await prisma.task.findMany({
    where: { sprintId, archivedAt: null },
    select: {
      title: true,
      status: true,
      storyPoints: true,
      assignee: { select: { name: true } },
    },
    orderBy: { position: 'asc' },
  })

  // Retrospective opcional: tomamos la más reciente (cerrada o no), con
  // preferencia por la última createdAt — patrón "ancla a la última activa"
  // documentado en `Sprint.retrospectives`.
  const retroRow = await prisma.retrospective.findFirst({
    where: { sprintId },
    orderBy: { createdAt: 'desc' },
    select: {
      title: true,
      notes: true,
      completedAt: true,
      data: true,
      facilitator: { select: { name: true } },
    },
  })

  const completedSp = tasks
    .filter((t) => t.status === 'DONE')
    .reduce((s, t) => s + (t.storyPoints ?? 0), 0)
  const plannedSp = tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0)
  const completedStories = tasks.filter((t) => t.status === 'DONE').length
  const plannedStories = tasks.length

  // Aplanamos `data.categories[].items[]` en una lista de takeaways
  // (`{category, text}`). El shape se valida laxo: si el JSON está
  // corrupto, devolvemos array vacío en lugar de explotar.
  const takeaways: Array<{ category: string; text: string }> = []
  if (retroRow?.data && typeof retroRow.data === 'object') {
    const root = retroRow.data as {
      categories?: Record<
        string,
        { label?: string; items?: Array<{ text?: string }> }
      >
    }
    const cats = root.categories ?? {}
    for (const [catId, cat] of Object.entries(cats)) {
      const label = cat?.label ?? catId
      for (const item of cat?.items ?? []) {
        if (item && typeof item.text === 'string' && item.text.length > 0) {
          takeaways.push({ category: label, text: item.text })
        }
      }
    }
  }

  return {
    project: { id: sprint!.project.id, name: sprint!.project.name },
    sprint: {
      id: sprint!.id,
      name: sprint!.name,
      goal: sprint!.goal ?? null,
      startDate: sprint!.startDate.toISOString(),
      endDate: sprint!.endDate.toISOString(),
      status: sprint!.status,
    },
    velocity: {
      plannedSp,
      completedSp,
      plannedStories,
      completedStories,
    },
    stories: tasks.map((t) => ({
      title: t.title,
      status: t.status,
      storyPoints: t.storyPoints ?? null,
      assignee: t.assignee?.name ?? null,
    })),
    retro: retroRow
      ? {
          title: retroRow.title,
          notes: retroRow.notes ?? null,
          completedAt: retroRow.completedAt
            ? retroRow.completedAt.toISOString()
            : null,
          facilitator: retroRow.facilitator?.name ?? null,
          takeaways,
        }
      : null,
    generatedAt: new Date().toISOString(),
  }
}

// ───────────────────────── API pública ─────────────────────────

/**
 * Genera el PDF del reporte solicitado. Aplica RBAC: si el usuario no
 * tiene visibilidad sobre el proyecto, lanza `[FORBIDDEN]`.
 *
 * @throws `[INVALID_INPUT]` — kind=sprint-review sin sprintId.
 * @throws `[FORBIDDEN]`     — sin visibilidad sobre el proyecto.
 * @throws `[NOT_FOUND]`     — proyecto o sprint inexistente.
 */
export async function generateProjectReport(
  args: GenerateProjectReportArgs,
): Promise<GenerateProjectReportResult> {
  const { sessionUser, projectId, kind, sprintId } = args

  if (kind !== 'status' && kind !== 'sprint-review') {
    reportError(
      'INVALID_INPUT',
      `kind '${String(kind)}' no soportado (status|sprint-review)`,
    )
  }
  if (kind === 'sprint-review' && !sprintId) {
    reportError(
      'INVALID_INPUT',
      'sprintId requerido para kind=sprint-review',
    )
  }

  // RBAC — re-usamos el mismo helper de visibilidad que los listados.
  const visibility = await resolveProjectVisibility(sessionUser)
  if (
    !visibility.unrestricted &&
    !visibility.visibleIds.includes(projectId)
  ) {
    reportError(
      'FORBIDDEN',
      `Usuario ${sessionUser.id} sin visibilidad sobre proyecto ${projectId}`,
    )
  }

  let element: ReturnType<typeof StatusReportPMI> | ReturnType<typeof SprintReviewReport>
  let filename: string

  if (kind === 'status') {
    const data = await loadStatusReportPMI(projectId)
    element = StatusReportPMI({ data })
    filename = sanitizeFilename(`Status-Report-${data.project.name}.pdf`)
  } else {
    const data = await loadSprintReviewReport(projectId, sprintId!)
    element = SprintReviewReport({ data })
    filename = sanitizeFilename(
      `Sprint-Review-${data.sprint.name}.pdf`,
    )
  }

  const buffer = await renderToBuffer(element)
  return { buffer, filename }
}

/**
 * Sustituye caracteres problemáticos para `Content-Disposition` (espacios,
 * acentos, slashes). Defensivo: el header debe ser ASCII; los nombres con
 * acentos los serializaríamos con `filename*=UTF-8''...` pero el scope
 * dice text-only así que normalizamos.
 */
function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}
