import prisma from '@/lib/prisma'
import { serializeTask } from '@/lib/types'
import { KanbanBoardClient } from '@/components/interactions/KanbanBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import { NewTaskButton } from '@/components/interactions/NewTaskButton'

export const dynamic = 'force-dynamic'

const COLUMNS = [
  { id: 'TODO', title: 'To Do', wipLimit: null },
  { id: 'IN_PROGRESS', title: 'In Progress', wipLimit: 3 },
  { id: 'REVIEW', title: 'Review', wipLimit: 2 },
  { id: 'DONE', title: 'Done', wipLimit: null },
] as const

export default async function KanbanBoard() {
  const tasks = await prisma.task.findMany({
    where: { parentId: null, archivedAt: null },
    include: {
      assignee: true,
      project: { include: { area: { include: { gerencia: true } } } },
      comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
      history: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      attachments: { include: { user: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: [{ position: 'asc' }, { priority: 'desc' }],
  })

  const tasksByColumn = Object.fromEntries(
    COLUMNS.map((c) => [
      c.id,
      tasks.filter((t) => t.status === c.id).map((t) => serializeTask(t)),
    ]),
  )

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

  return (
    <div className="flex h-full flex-col bg-background transition-colors duration-300">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card/50 px-8 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 text-xl font-semibold text-foreground">
            Tablero Kanban · DnD + Menú contextual
          </h1>
          <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center">
              <div className="mr-1.5 h-2 w-2 rounded-full bg-indigo-500"></div>{' '}
              Agile Story
            </span>
            <span className="flex items-center">
              <div className="mr-1.5 h-2 w-2 rounded-full bg-emerald-500"></div>{' '}
              PMI Task
            </span>
            <span className="flex items-center">
              <div className="mr-1.5 h-2 w-2 rounded-full bg-rose-500"></div>{' '}
              ITIL Ticket
            </span>
            <span className="ml-4 rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              Shift + / para atajos
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher />
          <NewTaskButton projects={projects} users={users} allTasks={allTasksRaw} />
        </div>
      </header>

      <KanbanBoardClient
        columns={[...COLUMNS]}
        tasksByColumn={tasksByColumn}
        projects={projects}
        users={users}
        gerencias={gerencias}
        areas={areas}
        allTasks={allTasksRaw}
      />
    </div>
  )
}
