import { Calendar, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { serializeTask } from '@/lib/types'
import { GanttBoardClient } from '@/components/interactions/GanttBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import { NewTaskButton } from '@/components/interactions/NewTaskButton'

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

      <div className="flex-1 overflow-auto p-6">
        <GanttBoardClient
          tasks={tasks}
          rangeStart={win.start.toISOString()}
          rangeDays={win.days}
          projects={projects}
          users={users}
          gerencias={gerencias}
          areas={areas}
          allTasks={allTasksRaw}
        />
      </div>
    </div>
  )
}
