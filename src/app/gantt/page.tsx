import { Calendar, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { serializeTask } from '@/lib/types'
import { GanttBoardClient } from '@/components/interactions/GanttBoardClient'
import { GlobalBreadcrumbs } from '@/components/interactions/GlobalBreadcrumbs'
import { ViewSwitcher } from '@/components/interactions/ViewSwitcher'

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
      project: true,
      comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  })

  const tasks = dbTasks.map((t) => serializeTask(t))

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
            Cronograma · Drag horizontal y resize
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Arrastra el cuerpo para desplazar; los bordes para redimensionar.
            Teclado: ←/→ desplaza, Shift+← /→ cambia fin, Alt+← /→ cambia inicio.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewSwitcher />
          <div className="flex items-center rounded-md bg-slate-800 p-1">
            <Link
              href={`?month=${win.prev}`}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="flex items-center gap-2 px-3 text-sm font-medium capitalize text-slate-200">
              <Calendar className="h-4 w-4" />
              {win.label}
            </span>
            <Link
              href={`?month=${win.next}`}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <button className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700">
            <Filter className="h-4 w-4" />
            Filtros
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <GanttBoardClient
          tasks={tasks}
          rangeStart={win.start.toISOString()}
          rangeDays={win.days}
          projects={projects}
          users={users}
        />
      </div>
    </div>
  )
}
