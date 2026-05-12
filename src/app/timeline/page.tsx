import { LineChart } from 'lucide-react'
import prisma from '@/lib/prisma'
import { TimelineBoardClient } from '@/components/timeline/TimelineBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import type { TimelineTask } from '@/lib/timeline/types'

export const dynamic = 'force-dynamic'

/**
 * US-4.2 Timeline View — vista global de línea de tiempo.
 *
 * Diferenciación respecto al Gantt (`/gantt`):
 *   - Zoom continuo (semanas / meses / trimestres) en lugar de mes fijo
 *   - Agrupación vertical (Project / Epic / Sprint / Status / Assignee)
 *   - Barras read-only sin CPM ni baselines
 *   - Density alta — multi-año visible en QUARTERS
 *
 * Carga TODAS las tareas con startDate y endDate definidos. La ventana
 * visible se filtra en cliente (sin paginación porque el zoom incluye
 * 12 semanas / 12 meses / 8 trimestres como máximo).
 */
export default async function TimelinePage() {
  // Cargamos catálogos en paralelo para alimentar `<TaskFiltersBar>` y el
  // selector de agrupamiento del Timeline. Mismo patrón que /list, /kanban
  // y /gantt: una sola RSC pasa todo el contexto al client component.
  const [tasks, projects, users, gerencias, areas, epics] = await Promise.all([
    prisma.task.findMany({
      where: {
        archivedAt: null,
        startDate: { not: null },
        endDate: { not: null },
      },
      select: {
        id: true,
        mnemonic: true,
        title: true,
        status: true,
        priority: true,
        type: true,
        startDate: true,
        endDate: true,
        progress: true,
        isMilestone: true,
        assigneeId: true,
        project: {
          select: {
            id: true,
            name: true,
            areaId: true,
            area: { select: { gerenciaId: true } },
          },
        },
        epic: { select: { id: true, name: true, color: true } },
        sprint: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: [{ startDate: 'asc' }],
    }),
    prisma.project.findMany({
      select: { id: true, name: true, areaId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.gerencia.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.area.findMany({
      select: { id: true, name: true, gerenciaId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.epic.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, color: true, projectId: true },
      orderBy: [{ projectId: 'asc' }, { position: 'asc' }],
    }),
  ])

  const serialized: TimelineTask[] = tasks.map((t) => ({
    id: t.id,
    mnemonic: t.mnemonic,
    title: t.title,
    status: t.status,
    priority: t.priority,
    type: t.type,
    startDate: t.startDate?.toISOString() ?? null,
    endDate: t.endDate?.toISOString() ?? null,
    progress: t.progress ?? 0,
    isMilestone: t.isMilestone,
    projectId: t.project.id,
    projectName: t.project.name,
    gerenciaId: t.project.area?.gerenciaId ?? null,
    areaId: t.project.areaId ?? null,
    epicId: t.epic?.id ?? null,
    epicName: t.epic?.name ?? null,
    epicColor: t.epic?.color ?? null,
    sprintId: t.sprint?.id ?? null,
    sprintName: t.sprint?.name ?? null,
    assignee: t.assignee,
    assigneeId: t.assigneeId ?? null,
  }))

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <LineChart className="h-5 w-5 text-indigo-400" />
            Timeline
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Línea de tiempo agrupable · {tasks.length} tarea
            {tasks.length === 1 ? '' : 's'} con fechas
          </p>
        </div>
        <ViewSwitcher />
      </header>

      <div className="flex-1 overflow-hidden">
        <TimelineBoardClient
          tasks={serialized}
          projects={projects}
          users={users}
          gerencias={gerencias}
          areas={areas}
          epics={epics}
        />
      </div>
    </div>
  )
}
