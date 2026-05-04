/**
 * Página /leveling (Ola P5).
 *
 * Vista dedicada al chequeo de hardDeadlines y al cálculo del plan de
 * resource leveling de un proyecto. La selección de proyecto es por
 * `?projectId=...`; si no se provee, se elige el primero accesible
 * para el usuario.
 *
 * Server Component: carga el chequeo de hardDeadlines en el primer
 * render para que el header agregado (counts) sea SSR-friendly. El
 * dialog de leveling es client component por interactividad.
 */

import Link from 'next/link'
import { ListChecks, AlertCircle } from 'lucide-react'
import prisma from '@/lib/prisma'
import { HardDeadlineWarnings } from '@/components/scheduling/HardDeadlineWarnings'
import { ResourceLevelingDialog } from '@/components/scheduling/ResourceLevelingDialog'
import { getHardDeadlineCheck } from '@/lib/actions/leveling'
import type { SerializableHardDeadlineCheck } from '@/lib/actions/leveling'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams?: Promise<{ projectId?: string }>
}

async function loadProjects(): Promise<{ id: string; name: string }[]> {
  return prisma.project.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

async function loadTaskTitles(
  projectId: string,
): Promise<Record<string, string>> {
  const tasks = await prisma.task.findMany({
    where: { projectId, archivedAt: null },
    select: { id: true, title: true },
  })
  const out: Record<string, string> = {}
  for (const t of tasks) out[t.id] = t.title
  return out
}

export default async function LevelingPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {}
  const projects = await loadProjects()
  const projectId = sp.projectId ?? projects[0]?.id

  if (!projectId || projects.length === 0) {
    return (
      <div className="flex h-full flex-col bg-background">
        <header className="flex h-16 shrink-0 items-center border-b border-border px-8 bg-subtle/50">
          <h1 className="text-xl font-semibold text-white">
            Nivelación de recursos
          </h1>
        </header>
        <div className="flex-1 p-6">
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No hay proyectos disponibles.
          </div>
        </div>
      </div>
    )
  }

  let check: SerializableHardDeadlineCheck | null = null
  let loadError: string | null = null
  try {
    check = await getHardDeadlineCheck(projectId)
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Error al cargar chequeo'
  }
  const taskTitles = await loadTaskTitles(projectId)

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Nivelación de recursos
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Vencimientos forzosos y nivelación greedy de carga por recurso
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector
            projects={projects}
            currentId={projectId}
          />
          <ResourceLevelingDialog projectId={projectId} />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[1100px] space-y-6">
          {loadError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/5 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-300">
                  Error al cargar
                </p>
                <p className="mt-1 text-xs text-red-200/70">{loadError}</p>
              </div>
            </div>
          )}

          {check && (
            <>
              <SummaryCards data={check} />
              <HardDeadlineWarnings data={check} taskTitleById={taskTitles} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCards({ data }: { data: SerializableHardDeadlineCheck }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card
        label="Tareas con vencimiento"
        value={data.summary.totalWithDeadline}
        tone="neutral"
      />
      <Card
        label="Violaciones"
        value={data.summary.violationCount}
        tone={data.summary.violationCount > 0 ? 'red' : 'green'}
      />
      <Card
        label="Advertencias"
        value={data.summary.warningCount}
        tone={data.summary.warningCount > 0 ? 'amber' : 'green'}
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
      <ListChecks className="h-4 w-4 text-indigo-400" />
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
                    href={`/leveling?projectId=${p.id}`}
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
