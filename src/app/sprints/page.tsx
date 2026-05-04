/**
 * Página `/sprints` (Ola P2 · Equipo P2-2).
 *
 * Vista del proyecto activo (heurística: el primer Project que el usuario
 * "ve" — coherente con el enfoque del Gantt y otras vistas que aún no
 * tienen selector global de proyecto). Muestra:
 *   1. Sprint activo (si existe) con SprintBoardClient + charts.
 *   2. Sprints en planificación (lista compacta).
 *   3. Sprints completados (histórico).
 *   4. Backlog del proyecto (tareas sin sprint).
 *
 * Errores de DB (tabla aún sin migrar) se atrapan y se renderiza un
 * fallback amable con CTA hacia `prisma migrate`.
 */

import {
  getBurndownData,
  getProjectBacklog,
  getSprintTasks,
  getSprintsWithMetrics,
  getVelocityHistory,
} from '@/lib/actions/sprints'
import prisma from '@/lib/prisma'
import { computeVelocity } from '@/lib/agile/burndown'
import SprintBoardClient from '@/components/sprints/SprintBoardClient'
import SprintBacklog from '@/components/sprints/SprintBacklog'
import VelocityChart from '@/components/sprints/VelocityChart'

export const dynamic = 'force-dynamic'

async function pickActiveProjectId(): Promise<string | null> {
  try {
    const project = await prisma.project.findFirst({
      where: { OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }] },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: { id: true },
    })
    return project?.id ?? null
  } catch {
    return null
  }
}

export default async function SprintsPage() {
  const projectId = await pickActiveProjectId()

  if (!projectId) {
    return (
      <PageShell>
        <div className="rounded-lg border border-dashed border-border bg-card/30 p-8 text-sm text-muted-foreground">
          No hay proyectos activos. Crea uno desde <code>/projects</code> para
          empezar a planificar Sprints.
        </div>
      </PageShell>
    )
  }

  let sprints: Awaited<ReturnType<typeof getSprintsWithMetrics>> = []
  let backlog: Awaited<ReturnType<typeof getProjectBacklog>> = []
  let velocity: Awaited<ReturnType<typeof getVelocityHistory>> = []

  try {
    ;[sprints, backlog, velocity] = await Promise.all([
      getSprintsWithMetrics(projectId),
      getProjectBacklog(projectId),
      getVelocityHistory(projectId, 10),
    ])
  } catch {
    // Migración pendiente: la columna `capacity` aún no existe ⇒ fallback.
    return (
      <PageShell>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-200">
          La migración de Sprints (capacity / storyPoints / velocityActual)
          aún no se ha aplicado. Ejecuta el SQL de
          <code className="mx-1 rounded bg-amber-500/20 px-1">
            prisma/migrations/20260501_sprints_velocity/migration.sql
          </code>
          y recarga.
        </div>
      </PageShell>
    )
  }

  const activeSprint = sprints.find((s) => s.status === 'ACTIVE') ?? null
  const planningSprints = sprints.filter((s) => s.status === 'PLANNING')
  const completedSprints = sprints.filter((s) => s.status === 'COMPLETED')

  let activeBoardData: Awaited<ReturnType<typeof getSprintTasks>> = []
  let burndown: Awaited<ReturnType<typeof getBurndownData>> = []
  if (activeSprint) {
    ;[activeBoardData, burndown] = await Promise.all([
      getSprintTasks(activeSprint.id),
      getBurndownData(activeSprint.id),
    ])
  }

  // Si no hay sprint activo pero sí historial, igual mostramos VelocityChart
  // a nivel de página para visualizar la salud del equipo.
  const velocityForPage = computeVelocity(
    sprints.map((s) => ({
      id: s.id,
      name: s.name,
      capacity: s.capacity,
      velocityActual: s.velocityActual,
      endedAt: s.endedAt,
      endDate: s.endDate,
    })),
  )

  return (
    <PageShell>
      <div className="space-y-8">
        {/* ── Sprint activo ───────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Sprint activo
          </h2>
          {activeSprint ? (
            <SprintBoardClient
              sprint={activeSprint}
              tasks={activeBoardData}
              burndown={burndown}
              velocity={velocity}
            />
          ) : (
            <div
              data-testid="no-active-sprint"
              className="rounded-lg border border-dashed border-border bg-card/30 p-6 text-sm text-muted-foreground"
            >
              No hay sprints activos. Inicia uno desde la lista de planificación.
            </div>
          )}
        </section>

        {/* ── Backlog ───────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Backlog del proyecto
          </h2>
          <SprintBacklog
            tasks={backlog}
            activeSprintId={activeSprint?.id ?? null}
          />
        </section>

        {/* ── Sprints en planificación ──────────────── */}
        {planningSprints.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Próximos sprints
            </h2>
            <div className="space-y-2">
              {planningSprints.map((s) => (
                <SprintRow key={s.id} sprint={s} />
              ))}
            </div>
          </section>
        )}

        {/* ── Sprints completados ───────────────────── */}
        {completedSprints.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Sprints cerrados
            </h2>
            <div className="space-y-2">
              {completedSprints.map((s) => (
                <SprintRow key={s.id} sprint={s} />
              ))}
            </div>
          </section>
        )}

        {/* ── Velocity histórica ─────────────────────── */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Velocity histórica
          </h2>
          <div className="rounded-lg border border-border bg-card/30 p-4">
            <VelocityChart data={velocityForPage} />
          </div>
        </section>
      </div>
    </PageShell>
  )
}

function SprintRow({
  sprint,
}: {
  sprint: Awaited<ReturnType<typeof getSprintsWithMetrics>>[number]
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold text-foreground">
          {sprint.name}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {sprint.status}
        </span>
      </div>
      <div className="flex gap-3 text-[11px] text-muted-foreground">
        <span>
          Capacity:{' '}
          <span className="font-semibold text-foreground">
            {sprint.capacity ?? '—'}
          </span>
        </span>
        <span>
          {sprint.completedPoints}/{sprint.totalPoints} pts
        </span>
        {sprint.velocityActual !== null && (
          <span>
            Velocity:{' '}
            <span className="font-semibold text-emerald-300">
              {sprint.velocityActual}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-subtle/50 px-8">
        <div>
          <h1 className="text-xl font-semibold text-white">Sprints</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Velocity, Burndown y Puntos de historia para el proyecto activo.
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </div>
    </div>
  )
}
