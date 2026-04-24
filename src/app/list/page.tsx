import prisma from '@/lib/prisma'
import { serializeTask, type SerializedTask } from '@/lib/types'
import { ListBoardClient } from '@/components/interactions/ListBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import { NewTaskButton } from '@/components/interactions/NewTaskButton'

export const dynamic = 'force-dynamic'

export default async function ListViewPage() {
  const dbTasks = await prisma.task.findMany({
    where: { parentId: null, archivedAt: null },
    include: {
      subtasks: {
        include: {
          assignee: true,
          project: { include: { area: { include: { gerencia: true } } } },
          comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
          history: { include: { user: true }, orderBy: { createdAt: 'desc' } },
          attachments: { include: { user: true }, orderBy: { createdAt: 'desc' } },
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      },
      assignee: true,
      project: { include: { area: { include: { gerencia: true } } } },
      comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
      history: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      attachments: { include: { user: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
  })

  const [projects, users, allTasksRaw, gerencias, areas] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true, areaId: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ orderBy: { name: 'asc' } }),
    prisma.task.findMany({
      where: { archivedAt: null },
      select: { id: true, title: true, mnemonic: true, projectId: true, project: { select: { id: true, name: true } } },
      orderBy: [{ project: { name: 'asc' } }, { title: 'asc' }],
    }),
    prisma.gerencia.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.area.findMany({ select: { id: true, name: true, gerenciaId: true }, orderBy: { name: 'asc' } }),
  ])

  const tasks: (SerializedTask & { subtasks: SerializedTask[] })[] = dbTasks.map(
    (t) => ({
      ...serializeTask(t),
      subtasks: t.subtasks.map((s: Record<string, unknown>) => serializeTask(s)),
    }),
  )

  return (
    <div className="flex h-full flex-col bg-background transition-colors duration-300">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-background px-6 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 text-2xl font-bold text-foreground">
            List View · DnD, atajos y panel lateral
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher />
          <NewTaskButton projects={projects} users={users} allTasks={allTasksRaw} />
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 pb-6 custom-scrollbar">
        <div className="min-w-[900px] rounded-lg border border-border bg-card shadow-sm">
          <div className="sticky top-0 z-10 grid grid-cols-12 gap-4 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <div className="col-span-4 pl-2">Tarea</div>
            <div className="col-span-2">Asignado</div>
            <div className="col-span-2">Estado</div>
            <div className="col-span-2">Fecha Límite</div>
            <div className="col-span-1 text-center">Prioridad</div>
            <div className="col-span-1 text-center">ID</div>
          </div>

          <ListBoardClient
            tasks={tasks}
            projects={projects}
            users={users}
            gerencias={gerencias}
            areas={areas}
          />
        </div>
      </div>
    </div>
  )
}
