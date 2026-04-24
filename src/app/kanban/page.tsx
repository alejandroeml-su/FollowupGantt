import { Plus } from 'lucide-react'
import prisma from '@/lib/prisma'
import { serializeTask } from '@/lib/types'
import { KanbanBoardClient } from '@/components/interactions/KanbanBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'

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
      project: true,
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

  const [projects, users] = await Promise.all([
    prisma.project.findMany({ orderBy: { name: 'asc' } }),
    prisma.user.findMany({ orderBy: { name: 'asc' } }),
  ])

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/50 px-8 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 text-xl font-semibold text-white">
            Tablero Kanban · DnD + Menú contextual
          </h1>
          <div className="mt-1 flex items-center gap-4 text-xs text-slate-400">
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
            <span className="ml-4 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
              Shift + / para atajos
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher />
          <button className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500">
            <Plus className="h-4 w-4" />
            Nueva Tarea
          </button>
        </div>
      </header>

      <KanbanBoardClient 
        columns={[...COLUMNS]} 
        tasksByColumn={tasksByColumn} 
        projects={projects} 
        users={users} 
      />
    </div>
  )
}
