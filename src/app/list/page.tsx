import prisma from '@/lib/prisma'
import { serializeTask, type SerializedTask } from '@/lib/types'
import { ListBoardClient } from '@/components/interactions/ListBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import { NewTaskButton } from '@/components/interactions/NewTaskButton'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { resolveProjectVisibility } from '@/lib/auth/visibility'
import { buildTaskTreeInclude, DEFAULT_TREE_DEPTH } from '@/lib/tasks/load-tree'

export const dynamic = 'force-dynamic'

export default async function ListViewPage() {
  // Wave P7 · C-DEBT-2 — Cargar la identidad del usuario activo para
  // drillarla al drawer (presence + edit locks). Sin sesión cae a `null`
  // y el drawer degrada (sin presence pero la UX de tarea sigue OK).
  const currentUser = await getCurrentUserPresence()

  // HU "Acceso Transversal por Asignación de Proyecto" (2026-05-12) — limita
  // las tareas y catálogos a los proyectos visibles para el usuario (su
  // gerencia base + asignaciones cross-gerencia). Sin sesión devolvemos
  // listas vacías para no exponer datos a anónimos.
  const sessionUser = await getCurrentUser()
  const visibility = await resolveProjectVisibility(sessionUser)

  const dbTasks = await prisma.task.findMany({
    where: { AND: [{ parentId: null, archivedAt: null }, visibility.taskWhere] },
    include: buildTaskTreeInclude({ depth: DEFAULT_TREE_DEPTH }),
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
  })

  // 2026-05-14 · Mantenimiento de archivadas (Edwin) — segunda query
  // dedicada para no inflar la query principal. Las archivadas pueden ser
  // descendientes profundos, así que no filtramos por parentId: queremos
  // ver cualquier tarea soft-deleted, plana. `buildTaskTreeInclude({depth:0})`
  // mantiene las relaciones base (assignee, project, history, etc.) sin
  // recurrir a subtasks. Si hay tareas activas con subtasks archivadas,
  // el filtro `archivedAt: { not: null }` se las trae igualmente.
  const dbArchivedTasks = await prisma.task.findMany({
    where: { AND: [{ archivedAt: { not: null } }, visibility.taskWhere] },
    include: buildTaskTreeInclude({ depth: 0 }),
    orderBy: [{ archivedAt: 'desc' }],
  })

  const [projects, users, allTasksRaw, gerencias, areas, epics] = await Promise.all([
    prisma.project.findMany({
      where: visibility.projectWhere,
      select: { id: true, name: true, areaId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({ orderBy: { name: 'asc' } }),
    prisma.task.findMany({
      where: { AND: [{ archivedAt: null }, visibility.taskWhere] },
      select: { id: true, title: true, mnemonic: true, projectId: true, project: { select: { id: true, name: true } } },
      orderBy: [{ project: { name: 'asc' } }, { title: 'asc' }],
    }),
    prisma.gerencia.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.area.findMany({ select: { id: true, name: true, gerenciaId: true }, orderBy: { name: 'asc' } }),
    // Wave P9 — Epics activas para selector + filtro.
    prisma.epic.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, color: true, projectId: true },
      orderBy: [{ projectId: 'asc' }, { position: 'asc' }],
    }),
  ])

  // serializeTask es recursivo (ver lib/types.ts:227 — recurre por
  // `t.subtasks`), así que con la query ya cargada en árbol, basta una
  // llamada por raíz para obtener N niveles serializados.
  const tasks: SerializedTask[] = dbTasks.map((t) =>
    serializeTask(t as unknown as Record<string, unknown>),
  )
  const archivedTasks: SerializedTask[] = dbArchivedTasks.map((t) =>
    serializeTask(t as unknown as Record<string, unknown>),
  )

  return (
    <div className="flex h-full flex-col bg-background transition-colors duration-300">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 text-2xl font-bold text-foreground">
            Vista de Lista
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher />
          <NewTaskButton projects={projects} users={users} allTasks={allTasksRaw} />
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 pb-6 custom-scrollbar">
        <div className="min-w-[900px] rounded-lg border border-border bg-card shadow-sm">
          <ListBoardClient
            tasks={tasks}
            archivedTasks={archivedTasks}
            projects={projects}
            users={users}
            gerencias={gerencias}
            areas={areas}
            epics={epics}
            currentUser={currentUser}
          />
        </div>
      </div>
    </div>
  )
}
