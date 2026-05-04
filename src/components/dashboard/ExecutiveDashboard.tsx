/**
 * Equipo D3 · ExecutiveDashboard — server component.
 *
 * Carga en paralelo (Promise.all) los datos de portafolio, riesgos,
 * next-actions y hitos. Renderiza un grid responsivo con las tarjetas
 * del dashboard ejecutivo unificado.
 *
 * Capas de datos (independientes, sin dependencia entre ellas):
 *   - getPortfolioReport         → semáforo + EVM agregado
 *   - getProjectRiskOverview     → top 5 riesgos (cross-project)
 *   - getUpcomingMilestones      → 5 hitos en 14 días
 *   - taskInsight (NEXT_ACTION)  → 5 próximas acciones IA activas
 *   - listMyWorkspaces / count   → KPIs y gating de empty state
 *
 * Decisiones D3:
 *   - D3-DASH-1 · `getPortfolioReport` requiere rol PM/ADMIN. Si el
 *     caller no tiene permiso lo capturamos y mostramos un report
 *     vacío (graceful degradation) — el dashboard sigue siendo útil
 *     para usuarios sin acceso global al portafolio.
 *   - D3-DASH-2 · El proyecto activo para "AI next actions" se infiere
 *     como el primero con score más alto cross-project. Cuando exista
 *     `User.activeProjectId` se reemplaza.
 */

import {
  getPortfolioReport,
  type EVMReportPayload,
} from '@/lib/actions/reports'
import { getProjectRiskOverview } from '@/lib/actions/insights'
import { getUpcomingMilestones } from '@/lib/dashboard/upcoming-milestones'
import prisma from '@/lib/prisma'
import type { PortfolioReport } from '@/lib/reports/portfolio'
import { PortfolioHealthCard } from './PortfolioHealthCard'
import { RiskHotspotsCard } from './RiskHotspotsCard'
import {
  AINextActionsCard,
  type AINextActionItem,
} from './AINextActionsCard'
import { EVMSnapshotCard } from './EVMSnapshotCard'
import { UpcomingMilestonesCard } from './UpcomingMilestonesCard'

// Re-export para tests (evitar desfase de tipos).
export type ExecutiveDashboardData = {
  portfolio: PortfolioReport
  topRisks: Awaited<ReturnType<typeof getProjectRiskOverview>>
  upcomingMilestones: Awaited<ReturnType<typeof getUpcomingMilestones>>
  nextActions: AINextActionItem[]
  delayedTaskCount: number
}

// Datos default cuando el caller no tiene acceso a getPortfolioReport.
const EMPTY_PORTFOLIO: PortfolioReport = {
  generatedAt: new Date(0).toISOString(),
  rows: [],
  summary: {
    totalProjects: 0,
    healthBreakdown: { green: 0, yellow: 0, red: 0, gray: 0 },
    activeProjects: 0,
    completedProjects: 0,
    avgProgress: 0,
    avgSPI: null,
    avgCPI: null,
  },
}

async function loadNextActions(limit = 5): Promise<AINextActionItem[]> {
  const rows = await prisma.taskInsight.findMany({
    where: { kind: 'NEXT_ACTION', dismissedAt: null },
    orderBy: { score: 'desc' },
    take: limit,
    select: { id: true, score: true, payload: true },
  })
  return rows.map((row) => {
    const payload = (row.payload ?? {}) as {
      key?: string
      message?: string
      count?: number
      projectId?: string
      projectName?: string
    }
    return {
      id: row.id,
      message: payload.message ?? payload.key ?? 'Acción sugerida',
      count: typeof payload.count === 'number' ? payload.count : 0,
      projectId: payload.projectId ?? null,
      projectName: payload.projectName ?? null,
      severity: row.score,
    }
  })
}

async function loadDelayedTaskCount(): Promise<number> {
  // "DELAYED" no es un status enum; aproximamos como tareas no DONE
  // con `endDate < ahora` y sin archivar.
  const now = new Date()
  return prisma.task.count({
    where: {
      archivedAt: null,
      status: { not: 'DONE' },
      endDate: { lt: now },
    },
  })
}

async function safeGetPortfolio(): Promise<PortfolioReport> {
  try {
    return await getPortfolioReport()
  } catch (err) {
    // [FORBIDDEN] cuando no hay rol PM/ADMIN — degradamos.
    if (err instanceof Error && err.message.startsWith('[FORBIDDEN')) {
      return EMPTY_PORTFOLIO
    }
    throw err
  }
}

export async function loadExecutiveDashboard(): Promise<ExecutiveDashboardData> {
  const [portfolio, topRisks, upcomingMilestones, nextActions, delayedTaskCount] =
    await Promise.all([
      safeGetPortfolio(),
      getProjectRiskOverview(5),
      getUpcomingMilestones({ days: 14, take: 5 }),
      loadNextActions(5),
      loadDelayedTaskCount(),
    ])
  return { portfolio, topRisks, upcomingMilestones, nextActions, delayedTaskCount }
}

function getGreeting(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Buenos días'
  if (hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

type Props = {
  userName: string
  data: ExecutiveDashboardData
  /** Inyectable para tests deterministas del greeting. */
  now?: Date
}

export function ExecutiveDashboard({ userName, data, now }: Props) {
  const { portfolio, topRisks, upcomingMilestones, nextActions, delayedTaskCount } =
    data
  const completionPct = portfolio.summary.avgProgress
  const greeting = getGreeting(now)

  return (
    <div
      data-testid="executive-dashboard"
      className="flex h-full flex-col bg-background"
    >
      <div className="flex-1 overflow-auto p-8 custom-scrollbar lg:p-12">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {greeting}, {userName.split(' ')[0]}
            </p>
            <h1 className="text-3xl font-black tracking-tight text-foreground lg:text-4xl">
              Resumen ejecutivo
            </h1>
          </header>

          {/* Row 1 · KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile
              testid="kpi-active-projects"
              label="Proyectos activos"
              value={portfolio.summary.activeProjects}
            />
            <KpiTile
              testid="kpi-delayed-tasks"
              label="Tareas retrasadas"
              value={delayedTaskCount}
              tone={delayedTaskCount > 0 ? 'warn' : 'ok'}
            />
            <KpiTile
              testid="kpi-upcoming-milestones"
              label="Hitos próximos"
              value={upcomingMilestones.length}
            />
            <KpiTile
              testid="kpi-completion"
              label="Completado promedio"
              value={`${completionPct}%`}
            />
          </div>

          {/* Row 2 · Portfolio health (full width) */}
          <PortfolioHealthCard
            rows={portfolio.rows}
            summary={portfolio.summary}
          />

          {/* Row 3 · EVM + Risks */}
          <div className="grid gap-6 lg:grid-cols-2">
            <EVMSnapshotCard report={portfolio} />
            <RiskHotspotsCard items={topRisks} limit={5} />
          </div>

          {/* Row 4 · AI + Milestones */}
          <div className="grid gap-6 lg:grid-cols-2">
            <AINextActionsCard items={nextActions} />
            <UpcomingMilestonesCard items={upcomingMilestones} />
          </div>
        </div>
      </div>
    </div>
  )
}

function KpiTile({
  label,
  value,
  tone = 'neutral',
  testid,
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'ok' | 'warn'
  testid: string
}) {
  const TONE_CLASS = {
    neutral: 'text-foreground',
    ok: 'text-emerald-500',
    warn: 'text-amber-500',
  } as const
  return (
    <div
      data-testid={testid}
      className="rounded-2xl bg-card border border-border p-5"
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-black ${TONE_CLASS[tone]}`}>{value}</p>
    </div>
  )
}

// Re-export para evitar warnings sobre import sin uso si se elimina algo.
export type { EVMReportPayload }
