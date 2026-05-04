/**
 * Ola P2 · Equipo P2-4 — Dashboard de Objetivos / OKRs.
 *
 * Server component: carga goals para el ciclo seleccionado (?cycle=Q1-2026
 * por defecto al actual) y pasa los catálogos al GoalsBoard cliente.
 *
 * Strings visibles en español según convención de repo: "Objetivos",
 * "Resultados clave", "Ciclo".
 */

import { Target } from 'lucide-react'
import prisma from '@/lib/prisma'
import { getGoalsForCycle } from '@/lib/actions/goals'
import { isValidCycle } from '@/lib/okr/progress'
import { GoalsBoard } from '@/components/goals/GoalsBoard'
import { getServerT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

type SP = Promise<{ cycle?: string; projectId?: string }>

function defaultCycle(): string {
  const d = new Date()
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return `Q${q}-${d.getUTCFullYear()}`
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: SP
}) {
  const sp = await searchParams
  const tt = await getServerT()
  const cycle = sp.cycle && isValidCycle(sp.cycle) ? sp.cycle : defaultCycle()
  const projectId = sp.projectId ?? null

  const [goals, users, projects, allTasks] = await Promise.all([
    getGoalsForCycle(cycle, projectId),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.task.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        title: true,
        mnemonic: true,
        project: { select: { name: true } },
      },
      orderBy: [{ project: { name: 'asc' } }, { title: 'asc' }],
      take: 500,
    }),
  ])

  const taskOptions = allTasks.map((t) => ({
    id: t.id,
    title: t.title,
    mnemonic: t.mnemonic,
    projectName: t.project?.name ?? null,
  }))

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
      <header className="flex items-center gap-2">
        <Target className="h-5 w-5 text-primary" aria-hidden />
        <h1 className="text-lg font-semibold">{tt('pages.goals.title')}</h1>
      </header>
      <p className="text-xs text-muted-foreground">
        OKRs por ciclo. Vincula tareas a resultados clave para que el progreso
        se actualice automáticamente cuando las tareas pasen a Completado.
      </p>

      <GoalsBoard
        goals={goals}
        users={users}
        projects={projects}
        tasks={taskOptions}
        cycle={cycle}
        projectId={projectId}
      />
    </main>
  )
}
