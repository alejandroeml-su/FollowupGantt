import {
  LayoutTemplate,
  AlertTriangle,
  Database,
  GitCompare,
} from 'lucide-react'
import type { TaskStatus, TaskType } from '@prisma/client'
import { getPortfolioKPIs, getKPIFilterOptions } from '@/lib/actions/kpis'
import type { KPIFilters } from '@/lib/kpi-calc'
import { KPIFilters as KPIFiltersPanel } from '@/components/dashboard/KPIFilters'
import { KPIDashboardView } from '@/components/dashboard/KPIDashboardView'

export const dynamic = 'force-dynamic'

const TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']
const TASK_TYPES: TaskType[] = ['AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET']

function firstParam(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}

function parseFilters(sp: Record<string, string | string[] | undefined>): KPIFilters {
  const status = firstParam(sp.status)
  const type = firstParam(sp.type)
  return {
    gerenciaId: firstParam(sp.gerencia),
    areaId: firstParam(sp.area),
    projectId: firstParam(sp.project),
    status: status && TASK_STATUSES.includes(status as TaskStatus) ? (status as TaskStatus) : undefined,
    type: type && TASK_TYPES.includes(type as TaskType) ? (type as TaskType) : undefined,
    assigneeId: firstParam(sp.assignee),
  }
}

export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const filters = parseFilters(sp)

  const [kpis, options] = await Promise.all([
    getPortfolioKPIs(filters),
    getKPIFilterOptions(),
  ])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-subtle/50 px-8">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <LayoutTemplate className="h-5 w-5 text-indigo-400" />
            Dashboards Ejecutivos & Gobernanza
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            KPIs PMBOK · EVM · Retorno · Eficiencia operativa
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <KPIFiltersPanel options={options} />

          <KPIDashboardView kpis={kpis} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/60 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between border-b border-border p-5">
                <h3 className="flex items-center gap-2 font-semibold text-white">
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                  Matriz de Riesgos (Impacto vs Probabilidad)
                </h3>
              </div>
              <div className="flex flex-1 items-center justify-center p-6">
                <div className="grid aspect-square w-full max-w-sm grid-cols-3 grid-rows-3 gap-1">
                  <div className="flex items-center justify-center rounded-tl-lg border border-amber-500/30 bg-amber-500/20 font-bold text-amber-400">
                    1
                  </div>
                  <div className="flex items-center justify-center border border-rose-500/30 bg-rose-500/20 font-bold text-rose-400">
                    4
                  </div>
                  <div className="flex items-center justify-center rounded-tr-lg border border-red-500/50 bg-red-600/30 text-2xl font-bold text-red-400">
                    2
                  </div>
                  <div className="flex items-center justify-center border border-emerald-500/30 bg-emerald-500/20 font-bold text-emerald-400">
                    0
                  </div>
                  <div className="flex items-center justify-center border border-amber-500/30 bg-amber-500/20 text-xl font-bold text-amber-400">
                    3
                  </div>
                  <div className="flex items-center justify-center border border-rose-500/30 bg-rose-500/20 font-bold text-rose-400">
                    1
                  </div>
                  <div className="flex items-center justify-center rounded-bl-lg border border-emerald-500/20 bg-emerald-500/10 font-bold text-emerald-600">
                    0
                  </div>
                  <div className="flex items-center justify-center border border-emerald-500/30 bg-emerald-500/20 font-bold text-emerald-400">
                    0
                  </div>
                  <div className="flex items-center justify-center rounded-br-lg border border-amber-500/30 bg-amber-500/20 font-bold text-amber-400">
                    0
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/60 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between border-b border-border p-5">
                <h3 className="flex items-center gap-2 font-semibold text-white">
                  <GitCompare className="h-4 w-4 text-blue-400" />
                  Gap Analysis (TI)
                </h3>
              </div>
              <div className="flex-1 space-y-6 p-6">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Infraestructura On-Premise (AS-IS)</span>
                    <span className="font-medium text-indigo-400">AWS Cloud (TO-BE)</span>
                  </div>
                  <div className="relative flex h-3 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full w-1/3 border-r border-background bg-muted-foreground/40" />
                    <div className="relative h-full w-1/3 overflow-hidden bg-indigo-500">
                      <div className="absolute inset-0 animate-pulse bg-white/20" />
                    </div>
                  </div>
                  <p className="mt-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
                    Migración 66% Completada
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-background p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground/90">
                    <Database className="h-4 w-4 text-emerald-400" /> CMDB Health
                  </h4>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex justify-between border-b border-border/50 pb-1">
                      <span>Servidores Mapeados:</span> <span className="text-foreground">142 / 150</span>
                    </li>
                    <li className="flex justify-between border-b border-border/50 pb-1">
                      <span>Incidentes Críticos:</span> <span className="text-red-400">2</span>
                    </li>
                    <li className="flex justify-between pb-1">
                      <span>SLA Cumplimiento:</span> <span className="text-emerald-400">98.5%</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
