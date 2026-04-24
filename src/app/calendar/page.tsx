import { Sparkles } from 'lucide-react'
import prisma from '@/lib/prisma'
import { serializeTask } from '@/lib/types'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'
import { NewTaskButton } from '@/components/interactions/NewTaskButton'
import { CalendarBoardClient } from '@/components/interactions/CalendarBoardClient'

export const dynamic = 'force-dynamic'

type SP = Promise<{ month?: string }>

function monthWindow(monthParam?: string): {
  start: Date
  days: number
  label: string
  prev: string
  next: string
} {
  const today = new Date()
  const base = monthParam
    ? new Date(`${monthParam}-01T00:00:00Z`)
    : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
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

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: SP
}) {
  const sp = await searchParams
  const win = monthWindow(sp.month)
  // Extendemos la ventana a +/- 1 semana para cubrir las celdas de overflow
  // que muestran días del mes anterior/siguiente en el mismo grid.
  const paddedStart = new Date(+win.start - 7 * 86_400_000)
  const paddedEnd = new Date(+win.start + (win.days + 7) * 86_400_000)

  const dbTasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      OR: [
        { startDate: { gte: paddedStart, lt: paddedEnd } },
        { endDate: { gte: paddedStart, lt: paddedEnd } },
        {
          AND: [
            { startDate: { lt: paddedStart } },
            { endDate: { gte: paddedEnd } },
          ],
        },
      ],
    },
    include: {
      assignee: true,
      project: {
        include: {
          area: {
            include: { gerencia: true },
          },
        },
      },
      comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
      history: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      attachments: { include: { user: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: [{ startDate: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
  })

  const tasks = dbTasks.map((t) => serializeTask(t))

  const [projects, users, gerencias, areas, allTasksRaw] = await Promise.all([
    prisma.project.findMany({
      select: { id: true, name: true, areaId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
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
    prisma.task.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        title: true,
        mnemonic: true,
        projectId: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ project: { name: 'asc' } }, { title: 'asc' }],
    }),
  ])

  return (
    <div className="flex h-full flex-col bg-background transition-colors duration-300">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card/50 px-8 py-4">
        <div>
          <GlobalBreadcrumbs />
          <h1 className="mt-1 text-xl font-semibold text-foreground">
            Calendar View · Planificación mensual
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Click en una fecha para crear actividad. Arrastra una actividad a otro
            día para moverla. Filtra por Gerencia, Área o Proyecto para ver el mes completo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher />
          <button className="hidden items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 md:inline-flex">
            <Sparkles className="h-3.5 w-3.5" />
            ClickUp Brain
          </button>
          <NewTaskButton projects={projects} users={users} allTasks={allTasksRaw} />
        </div>
      </header>

      <CalendarBoardClient
        tasks={tasks}
        monthStart={win.start.toISOString()}
        monthDays={win.days}
        prevMonthHref={`?month=${win.prev}`}
        nextMonthHref={`?month=${win.next}`}
        monthLabel={win.label}
        gerencias={gerencias}
        areas={areas}
        projects={projects}
        users={users}
      />
    </div>
  )
}
