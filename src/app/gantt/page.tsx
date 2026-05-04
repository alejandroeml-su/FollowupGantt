import { Calendar, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { serializeTask } from '@/lib/types'
import {
  GanttBoardClient,
  type GanttCpmInfo,
  type GanttDependencyDescriptor,
} from '@/components/interactions/GanttBoardClient'
import { GanttListMobile } from '@/components/interactions/GanttListMobile'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import { NewTaskButton } from '@/components/interactions/NewTaskButton'
import { getCachedCpmForProject } from '@/lib/scheduling/cache'
import { getBaselinesForProject } from '@/lib/actions/baselines'

export const dynamic = 'force-dynamic'

type SP = Promise<{ month?: string }>

function monthWindow(monthParam?: string): {
  start: Date
  days: number
  label: string
  prev: string
  next: string
} {
  // monthParam formato YYYY-MM; fallback al mes actual
  const today = new Date()
  const base = monthParam
    ? new Date(`${monthParam}-01T00:00:00Z`)
    : new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
      )

  const year = base.getUTCFullYear()
  const month = base.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1))
  const next = new Date(Date.UTC(year, month + 1, 1))
  const days = Math.round((+next - +start) / 86_400_000)
  const prevD = new Date(Date.UTC(year, month - 1, 1))

  const label = start.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`

  return { start, days, label, prev: fmt(prevD), next: fmt(next) }
}

function mapPrismaDepType(t: string): 'FS' | 'SS' | 'FF' | 'SF' {
  switch (t) {
    case 'START_TO_START':
      return 'SS'
    case 'FINISH_TO_FINISH':
      return 'FF'
    case 'START_TO_FINISH':
      return 'SF'
    case 'FINISH_TO_START':
    default:
      return 'FS'
  }
}

/**
 * Calcula CPM para todos los proyectos con tareas visibles y agrega los
 * resultados en un único mapa indexado por taskId. Decisión D8: el Gantt
 * sigue mostrando fechas reales de BD; CPM solo informa visualmente
 * (críticas en rojo + tooltip con float).
 */
async function computeCpmForProjects(projectIds: string[]): Promise<{
  cpmByTaskId: Record<string, GanttCpmInfo>
  hasCycle: boolean
}> {
  const cpmByTaskId: Record<string, GanttCpmInfo> = {}
  let hasCycle = false

  // En paralelo — cada proyecto es independiente. Cada llamada está
  // cacheada con tag `cpm:<projectId>` (HU-2.1); ver invalidate.ts.
  const outputs = await Promise.all(
    projectIds.map((pid) => getCachedCpmForProject(pid)),
  )

  for (const out of outputs) {
    if (!out) continue
    if (out.warnings.some((w) => w.code === 'CYCLE')) hasCycle = true
    for (const r of out.results) {
      cpmByTaskId[r.id] = {
        id: r.id,
        ES: r.ES,
        EF: r.EF,
        LS: r.LS,
        LF: r.LF,
        totalFloat: r.totalFloat,
        isCritical: r.isCritical,
      }
    }
  }

  return { cpmByTaskId, hasCycle }
}

export default async function GanttTimeline({
  searchParams,
}: {
  searchParams: SP
}) {
  const sp = await searchParams
  const win = monthWindow(sp.month)
  const rangeEnd = new Date(+win.start + win.days * 86_400_000)

  const dbTasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      OR: [
        { startDate: { gte: win.start, lt: rangeEnd } },
        { endDate: { gte: win.start, lt: rangeEnd } },
        {
          AND: [
            { startDate: { lt: win.start } },
            { endDate: { gte: rangeEnd } },
          ],
        },
        { AND: [{ startDate: null }, { endDate: null }] },
      ],
    },
    include: {
      assignee: true,
      project: { include: { area: { include: { gerencia: true } } } },
      comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
      history: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      attachments: { include: { user: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  })

  const tasks = dbTasks.map((t) => serializeTask(t))

  const [projects, users, allTasksRaw, gerencias, areas, taskCountsRaw, baselineCountsRaw] =
    await Promise.all([
      prisma.project.findMany({ select: { id: true, name: true, areaId: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({ orderBy: { name: 'asc' } }),
      prisma.task.findMany({
        where: { archivedAt: null },
        select: { id: true, title: true, mnemonic: true, projectId: true, project: { select: { id: true, name: true } } },
        orderBy: [{ project: { name: 'asc' } }, { title: 'asc' }],
      }),
      prisma.gerencia.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.area.findMany({ select: { id: true, name: true, gerenciaId: true }, orderBy: { name: 'asc' } }),
      // HU-3.1 · conteo de tareas no archivadas por proyecto, para habilitar
      // el botón de captura de línea base con el preview "se capturarán N
      // tareas". groupBy es un round-trip barato comparado con cargar todas
      // las tareas de todos los proyectos.
      prisma.task.groupBy({
        by: ['projectId'],
        where: { archivedAt: null },
        _count: { _all: true },
      }),
      // HU-3.1 · conteo de líneas base existentes por proyecto, para el
      // banner de soft cap (D10).
      prisma.baseline.groupBy({
        by: ['projectId'],
        _count: { _all: true },
      }),
    ])

  const taskCountByProject: Record<string, number> = {}
  for (const row of taskCountsRaw) {
    if (row.projectId) taskCountByProject[row.projectId] = row._count._all
  }
  const baselineCountByProject: Record<string, number> = {}
  for (const row of baselineCountsRaw) {
    if (row.projectId) baselineCountByProject[row.projectId] = row._count._all
  }

  // HU-3.2 · listado descriptivo de líneas base solo para proyectos que ya
  // tengan al menos una. Cada llamada está cacheada vía `unstable_cache`
  // con tag `baselines:<projectId>`; tras `captureBaseline` se invalida y
  // el siguiente render trae la lista actualizada.
  const projectsWithBaselines = Object.entries(baselineCountByProject)
    .filter(([, n]) => n > 0)
    .map(([pid]) => pid)
  const baselinesByProject: Record<
    string,
    Awaited<ReturnType<typeof getBaselinesForProject>>
  > = {}
  if (projectsWithBaselines.length > 0) {
    const lists = await Promise.all(
      projectsWithBaselines.map((pid) => getBaselinesForProject(pid)),
    )
    projectsWithBaselines.forEach((pid, i) => {
      baselinesByProject[pid] = lists[i]
    })
  }

  // ───── HU-1.2: cargar dependencias y CPM de los proyectos visibles ─────
  const visibleTaskIds = dbTasks.map((t) => t.id)
  const visibleProjectIds = Array.from(
    new Set(dbTasks.map((t) => t.projectId).filter((p): p is string => !!p)),
  )

  let dependencies: GanttDependencyDescriptor[] = []
  let cpmByTaskId: Record<string, GanttCpmInfo> = {}
  let hasCpmCycle = false

  if (visibleTaskIds.length > 0) {
    try {
      const [depsDb, cpmAgg] = await Promise.all([
        prisma.taskDependency.findMany({
          where: {
            AND: [
              { predecessorId: { in: visibleTaskIds } },
              { successorId: { in: visibleTaskIds } },
            ],
          },
          select: {
            id: true,
            predecessorId: true,
            successorId: true,
            type: true,
            lagDays: true,
          },
        }),
        computeCpmForProjects(visibleProjectIds),
      ])

      dependencies = depsDb.map((d) => ({
        id: d.id,
        predecessorId: d.predecessorId,
        successorId: d.successorId,
        type: mapPrismaDepType(d.type),
        // Lectura defensiva: la columna lagDays puede no existir aún en la
        // BD productiva (migración pendiente). Prisma 7 retorna undefined
        // si el cliente generado no incluye el campo.
        lagDays: d.lagDays ?? 0,
      }))
      cpmByTaskId = cpmAgg.cpmByTaskId
      hasCpmCycle = cpmAgg.hasCycle
    } catch {
      // Si la query de dependencias falla (ej. lagDays missing),
      // degradamos sin flechas pero sin romper el Gantt.
      dependencies = []
      cpmByTaskId = {}
      hasCpmCycle = false
    }
  }

  return (
    <div className="flex h-full flex-col bg-background transition-colors duration-300">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card/50 px-8 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 text-xl font-semibold text-foreground">
            Cronograma · Drag horizontal y resize
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Arrastra el cuerpo para desplazar; los bordes para redimensionar.
            Teclado: ←/→ desplaza, Shift+← /→ cambia fin, Alt+← /→ cambia inicio.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher />
          <div className="flex items-center rounded-md bg-muted p-1">
            <Link
              href={`?month=${win.prev}`}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="flex items-center gap-2 px-3 text-sm font-medium capitalize text-foreground">
              <Calendar className="h-4 w-4" />
              {win.label}
            </span>
            <Link
              href={`?month=${win.next}`}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <button className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent">
            <Filter className="h-4 w-4" />
            Filtros
          </button>
          <NewTaskButton projects={projects} users={users} allTasks={allTasksRaw} />
        </div>
      </header>

      {/* Mobile: lista vertical (Gantt timeline inusable en <sm). */}
      <div className="flex-1 overflow-auto md:hidden">
        <GanttListMobile
          tasks={tasks}
          rangeLabel={win.label}
          projects={projects}
          users={users}
          allTasks={tasks}
        />
      </div>

      {/* Tablet+desktop: timeline interactivo. */}
      <div className="hidden flex-1 overflow-auto p-6 md:block">
        <GanttBoardClient
          tasks={tasks}
          rangeStart={win.start.toISOString()}
          rangeDays={win.days}
          projects={projects}
          users={users}
          gerencias={gerencias}
          areas={areas}
          allTasks={allTasksRaw}
          cpmByTaskId={cpmByTaskId}
          dependencies={dependencies}
          hasCpmCycle={hasCpmCycle}
          taskCountByProject={taskCountByProject}
          baselineCountByProject={baselineCountByProject}
          baselinesByProject={baselinesByProject}
        />
      </div>
    </div>
  )
}
