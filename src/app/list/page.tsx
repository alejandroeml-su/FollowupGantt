import prisma from '@/lib/prisma'
import { serializeTask, type SerializedTask } from '@/lib/types'
import { ListBoardClient } from '@/components/interactions/ListBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import { NewTaskButton } from '@/components/interactions/NewTaskButton'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'

export const dynamic = 'force-dynamic'

export default async function ListViewPage() {
  // Wave P7 · C-DEBT-2 — Cargar la identidad del usuario activo para
  // drillarla al drawer (presence + edit locks). Sin sesión cae a `null`
  // y el drawer degrada (sin presence pero la UX de tarea sigue OK).
  const currentUser = await getCurrentUserPresence()

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
            projects={projects}
            users={users}
            gerencias={gerencias}
            areas={areas}
            currentUser={currentUser}
          />
        </div>
      </div>
    </div>
  )
}
