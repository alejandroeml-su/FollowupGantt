import { LineChart } from 'lucide-react'
import prisma from '@/lib/prisma'
import { TimelineBoardClient } from '@/components/timeline/TimelineBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import { NewTaskButton } from '@/components/interactions/NewTaskButton'
import { MobileTaskFAB } from '@/components/mobile/MobileTaskFAB'
import type { TimelineTask } from '@/lib/timeline/types'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { resolveProjectVisibility } from '@/lib/auth/visibility'
import { serializeTask, type SerializedTask } from '@/lib/types'
import { buildTaskTreeInclude, DEFAULT_TREE_DEPTH } from '@/lib/tasks/load-tree'
import { getServerT } from '@/lib/i18n/server'

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
  // HU "Acceso Transversal por Asignación de Proyecto" (2026-05-12) —
  // limita tareas y proyectos visibles a la gerencia base + asignaciones
  // cross-gerencia.
  const sessionUser = await getCurrentUser()
  const visibility = await resolveProjectVisibility(sessionUser)
  // 2026-05-14 · TaskDrawer presence/lock identity para abrir tareas inline.
  const currentUser = await getCurrentUserPresence()

  // Cargamos catálogos en paralelo para alimentar `<TaskFiltersBar>` y el
  // selector de agrupamiento del Timeline. Mismo patrón que /list, /kanban
  // y /gantt: una sola RSC pasa todo el contexto al client component.
  // 2026-05-14 · También cargamos el árbol completo (`buildTaskTreeInclude`)
  // para que al hacer click en una barra se pueda abrir el TaskDrawer con
  // datos hidratados sin un fetch extra.
  const [tasks, fullTasks, projects, users, gerencias, areas, epics] = await Promise.all([
    prisma.task.findMany({
      where: {
        AND: [
          {
            archivedAt: null,
            startDate: { not: null },
            endDate: { not: null },
          },
          visibility.taskWhere,
        ],
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
    prisma.task.findMany({
      where: {
        AND: [
          { archivedAt: null, startDate: { not: null }, endDate: { not: null } },
          visibility.taskWhere,
        ],
      },
      include: buildTaskTreeInclude({ depth: DEFAULT_TREE_DEPTH }),
      orderBy: [{ startDate: 'asc' }],
    }),
    prisma.project.findMany({
      where: visibility.projectWhere,
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

  const fullSerialized: SerializedTask[] = fullTasks.map((t) =>
    serializeTask(t as unknown as Record<string, unknown>),
  )

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

  // Wave R5E (2026-05-17) — Header bilingüe.
  const t = await getServerT()

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <LineChart className="h-5 w-5 text-indigo-400" />
            {t('pages.timeline.title')}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('pages.timeline.subtitle')} · {tasks.length}
          </p>
        </div>
        <ViewSwitcher />
      </header>

      <div className="flex-1 overflow-hidden">
        <TimelineBoardClient
          tasks={serialized}
          fullTasks={fullSerialized}
          projects={projects}
          users={users}
          gerencias={gerencias}
          areas={areas}
          epics={epics}
          currentUser={currentUser}
        />
      </div>
      {/* Wave R5E · mobile-first refinements — FAB para crear tarea.
          Timeline no monta NewTaskButton en su header (read-only), pero
          el FAB despacha requestNewTask() y cualquier NewTaskButton en
          otra vista no aplica aquí. Para el FAB en /timeline, montamos
          también un NewTaskButton "headless" oculto que reacciona al
          tick y abre el modal — patrón análogo a /list y /kanban donde
          el botón vive en el header. */}
      <TimelineMobileNewTaskBridge
        projects={projects}
        users={users}
      />
      <MobileTaskFAB />
    </div>
  )
}

/**
 * Wave R5E · Bridge para que el FAB de mobile en /timeline pueda abrir
 * el modal de creación de tareas. La timeline page no tiene un
 * NewTaskButton visible en su header (es una vista de lectura), así
 * que montamos uno con label vacío y display:none — sólo nos importa
 * que esté presente para que su efecto `useEffect(requestedAt)` abra
 * el TaskCreationModal cuando el FAB dispare requestNewTask().
 */
function TimelineMobileNewTaskBridge({
  projects,
  users,
}: {
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
}) {
  return (
    <div className="sr-only" aria-hidden="true">
      <NewTaskButton projects={projects} users={users} allTasks={[]} />
    </div>
  )
}
