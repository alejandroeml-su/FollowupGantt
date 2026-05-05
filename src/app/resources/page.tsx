/**
 * Página /resources (Ola P8 · Equipo P8-1).
 *
 * Dashboard de Resource Management:
 *   - Header con selector de proyecto y rango de fechas (defaults a las
 *     próximas 4 semanas).
 *   - WorkloadChart con vertical bars de carga vs capacidad por usuario.
 *   - Lista de sugerencias de rebalanceo emitidas por `suggestRebalance`.
 *   - SkillMatrix editable.
 *
 * Server Component: carga workload + matriz vía `getProjectWorkload` y
 * `getSkillMatrix`. Si la migración 20260505 aún no se aplicó, las
 * subconsultas de skills cae a vacío (manejado en `lib/actions/resources`).
 */

import Link from 'next/link'
import { Users2, BarChart3, AlertCircle } from 'lucide-react'
import prisma from '@/lib/prisma'
import {
  getProjectWorkload,
  getSkillMatrix,
  type SerializableWorkloadResponse,
} from '@/lib/actions/resources'
import { WorkloadChart } from '@/components/resources/WorkloadChart'
import { SkillMatrix } from '@/components/resources/SkillMatrix'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams?: Promise<{
    projectId?: string
    rangeStart?: string
    rangeEnd?: string
  }>
}

const DEFAULT_RANGE_DAYS = 28

function todayUtc(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function isoFromDate(d: Date): string {
  return d.toISOString()
}

function defaultRange(): { rangeStart: Date; rangeEnd: Date } {
  const start = todayUtc()
  const end = new Date(start.getTime() + (DEFAULT_RANGE_DAYS - 1) * 86_400_000)
  return { rangeStart: start, rangeEnd: end }
}

async function loadProjects() {
  return prisma.project.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

export default async function ResourcesPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {}
  const projects = await loadProjects()
  const projectId = sp.projectId ?? projects[0]?.id

  const { rangeStart: defStart, rangeEnd: defEnd } = defaultRange()
  const rangeStartIso = sp.rangeStart ?? isoFromDate(defStart)
  const rangeEndIso = sp.rangeEnd ?? isoFromDate(defEnd)

  const skillMatrix = await getSkillMatrix()

  if (!projectId || projects.length === 0) {
    return (
      <div className="flex h-full flex-col bg-background">
        <header className="flex h-16 shrink-0 items-center border-b border-border px-8 bg-subtle/50">
          <h1 className="text-xl font-semibold text-white">
            Resource Management
          </h1>
        </header>
        <div className="flex-1 p-6 space-y-6">
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No hay proyectos disponibles. Crea uno para ver carga y skills.
          </div>
          <SkillMatrix
            users={skillMatrix.users}
            skills={skillMatrix.skills}
            cells={skillMatrix.cells}
          />
        </div>
      </div>
    )
  }

  let workload: SerializableWorkloadResponse | null = null
  let workloadError: string | null = null
  try {
    workload = await getProjectWorkload({
      projectId,
      rangeStart: rangeStartIso,
      rangeEnd: rangeEndIso,
    })
  } catch (e) {
    workloadError = e instanceof Error ? e.message : 'Error al cargar workload'
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Resource Management
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Carga vs capacidad · sugerencias de rebalanceo · matriz de skills
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector projects={projects} currentId={projectId} />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[1400px] space-y-8">
          {workloadError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/5 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-300">
                  Error al cargar workload
                </p>
                <p className="mt-1 text-xs text-red-200/70">{workloadError}</p>
              </div>
            </div>
          )}

          {workload && (
            <>
              <SummaryCards data={workload} />

              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                  <BarChart3 className="h-5 w-5 text-indigo-400" />
                  Carga vs Capacidad
                </h2>
                <WorkloadChart
                  entries={workload.entries}
                  days={workload.days}
                />
              </section>

              {workload.rebalanceSuggestions.length > 0 && (
                <section className="space-y-3">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                    <Users2 className="h-5 w-5 text-emerald-400" />
                    Sugerencias de rebalanceo
                  </h2>
                  <ul className="space-y-2">
                    {workload.rebalanceSuggestions.map((s) => (
                      <li
                        key={`${s.taskId}-${s.toUserId}`}
                        className="flex items-start gap-3 rounded-md border border-border bg-card/40 p-3 text-sm"
                      >
                        <Users2 className="h-4 w-4 mt-0.5 text-emerald-400" />
                        <div>
                          <p className="font-medium text-white">
                            {s.taskTitle}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.rationale}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <section className="space-y-3 pt-4 border-t border-border">
            <SkillMatrix
              users={skillMatrix.users}
              skills={skillMatrix.skills}
              cells={skillMatrix.cells}
            />
          </section>
        </div>
      </div>
    </div>
  )
}

function SummaryCards({ data }: { data: SerializableWorkloadResponse }) {
  const totalOverloadDays = data.entries.reduce(
    (acc, e) => acc + e.totalOverloadDays,
    0,
  )
  const totalOverloadHours = data.entries.reduce(
    (acc, e) => acc + e.totalOverloadHours,
    0,
  )
  const userCount = data.entries.length

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card label="Usuarios con carga" value={userCount} tone="neutral" />
      <Card
        label="Días con sobrecarga"
        value={totalOverloadDays}
        tone={totalOverloadDays > 0 ? 'red' : 'green'}
      />
      <Card
        label="Horas excedidas"
        value={Math.round(totalOverloadHours)}
        tone={totalOverloadHours > 0 ? 'amber' : 'green'}
      />
    </div>
  )
}

function Card({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'red' | 'amber' | 'green' | 'neutral'
}) {
  const ring =
    tone === 'red'
      ? 'border-red-500/40'
      : tone === 'amber'
        ? 'border-amber-500/40'
        : tone === 'green'
          ? 'border-emerald-500/30'
          : 'border-border'
  return (
    <div className={`rounded-xl border ${ring} bg-card p-4`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

function ProjectSelector({
  projects,
  currentId,
}: {
  projects: { id: string; name: string }[]
  currentId: string
}) {
  const current = projects.find((p) => p.id === currentId)
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs">
      <Users2 className="h-4 w-4 text-indigo-400" />
      <span className="text-muted-foreground">Proyecto:</span>
      <span className="font-medium text-foreground" title={current?.id}>
        {current?.name ?? currentId}
      </span>
      {projects.length > 1 && (
        <details className="relative">
          <summary className="cursor-pointer rounded px-2 py-0.5 text-muted-foreground hover:bg-card">
            cambiar
          </summary>
          <div className="absolute right-0 top-full z-10 mt-1 w-64 max-h-72 overflow-auto rounded-md border border-border bg-card shadow-xl">
            <ul className="py-1 text-xs">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/resources?projectId=${p.id}`}
                    className={`block px-3 py-1.5 hover:bg-secondary ${
                      p.id === currentId
                        ? 'font-medium text-indigo-300'
                        : 'text-foreground'
                    }`}
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  )
}
