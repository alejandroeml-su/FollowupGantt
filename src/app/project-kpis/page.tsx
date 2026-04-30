import { BarChart3 } from 'lucide-react'
import type { TaskStatus, TaskType } from '@prisma/client'
import { getProjectsKPIs, getKPIFilterOptions } from '@/lib/actions/kpis'
import type { KPIFilters } from '@/lib/kpi-calc'
import { KPIFilters as KPIFiltersPanel } from '@/components/dashboard/KPIFilters'
import { ProjectKPIsTable } from '@/components/dashboard/ProjectKPIsTable'

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

export default async function ProjectKPIsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const filters = parseFilters(sp)

  const [rows, options] = await Promise.all([
    getProjectsKPIs(filters),
    getKPIFilterOptions(),
  ])

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-subtle/50 px-8">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <BarChart3 className="h-5 w-5 text-indigo-400" />
            KPIs de Proyectos
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Indicadores PMBOK por proyecto · EVM, ROI, Avance, Salud
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <KPIFiltersPanel options={options} />

          <ProjectKPIsTable rows={rows} />
        </div>
      </div>
    </div>
  )
}
