'use client'

/**
 * Wave P9 · Agile Maturity (HU-9.5) — Vista de Releases del proyecto.
 *
 * Layout grid de cards. Cada card muestra:
 *   - Nombre + version (chip mono)
 *   - Status derivado con color (RELEASED / DELAYED / AT_RISK / ON_TRACK)
 *   - % completado (rollup de epics o sprints según scopeMode)
 *   - Días restantes hasta plannedDate (o fecha de release si ya salió)
 *   - Lista compacta del scope (Epics o Sprints incluidos)
 *   - Owner
 *   - Acciones inline: editar / mark released / archivar
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  Pencil,
  Archive,
  Rocket,
  Calendar,
  User,
  CheckCircle2,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  archiveRelease,
  markReleaseAsReleased,
  type SerializedRelease,
} from '@/lib/actions/releases'
import {
  averageProgress,
  daysUntil,
  deriveReleaseStatus,
  releaseStatusLabel,
  type DerivedReleaseStatus,
} from '@/lib/releases/status'
import { NewReleaseModal, type ReleaseModalInitial } from './NewReleaseModal'
import { toast } from '@/components/interactions/Toaster'

type Props = {
  project: { id: string; name: string }
  releases: SerializedRelease[]
  users: { id: string; name: string }[]
  epics: { id: string; name: string; color: string }[]
  sprints: {
    id: string
    name: string
    startDate: string | null
    endDate: string | null
  }[]
}

const STATUS_TONE: Record<DerivedReleaseStatus, string> = {
  RELEASED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  DELAYED: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  AT_RISK: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  ON_TRACK: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
}

export default function ReleasesClient({
  project,
  releases,
  users,
  epics,
  sprints,
}: Props) {
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<SerializedRelease | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleArchive = (id: string, name: string) => {
    if (!confirm(`¿Archivar la Release "${name}"?`)) return
    startTransition(async () => {
      try {
        await archiveRelease({ id })
        toast.success('Release archivada')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const handleMarkReleased = (id: string, name: string) => {
    if (!confirm(`¿Marcar "${name}" como liberada con fecha de hoy?`)) return
    startTransition(async () => {
      try {
        await markReleaseAsReleased({ id })
        toast.success('Release marcada como liberada')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const editingInitial = (r: SerializedRelease): ReleaseModalInitial => ({
    id: r.id,
    name: r.name,
    version: r.version,
    description: r.description,
    scopeMode: r.scopeMode,
    plannedDate: r.plannedDate,
    ownerId: r.ownerId,
    selectedEpicIds: r.epics.map((e) => e.id),
    selectedSprintIds: r.sprints.map((s) => s.id),
  })

  return (
    <>
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href={`/projects/${project.id}/epics`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> {project.name}
          </Link>
          <h1 className="mt-1 text-xl font-bold text-foreground">
            Releases · Roadmap
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Versiones planificadas con scope (Epics o Sprints) y fecha de
            entrega. Útil para comunicar a stakeholders.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Nueva Release
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {releases.length === 0 ? (
          <div className="mx-auto max-w-md rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <h2 className="text-base font-semibold text-foreground">
              Aún no hay Releases
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Crea la primera para empezar a planificar entregables versionados
              y comunicar el roadmap.
            </p>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Crear primera Release
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
            {releases.map((r) => {
              const progressValues =
                r.scopeMode === 'EPIC'
                  ? r.epics.map((e) => e.progressPct)
                  : r.sprints.map((s) => s.progressPct)
              const progress = averageProgress(progressValues) ?? 0
              const status = deriveReleaseStatus(
                {
                  plannedDate: r.plannedDate,
                  releasedDate: r.releasedDate,
                  progressPct: progress,
                },
                new Date(),
              )
              const days = daysUntil(r.plannedDate)
              return (
                <article
                  key={r.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  {/* Header card */}
                  <header className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-foreground">
                          {r.name}
                        </h3>
                        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground border border-border/40">
                          {r.version}
                        </span>
                      </div>
                      {r.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {r.description}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        aria-label="Editar"
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!r.releasedDate && (
                        <button
                          type="button"
                          onClick={() => handleMarkReleased(r.id, r.name)}
                          disabled={isPending}
                          aria-label="Marcar como liberada"
                          title="Marcar como liberada"
                          className="rounded p-1 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleArchive(r.id, r.name)}
                        disabled={isPending}
                        aria-label="Archivar"
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </header>

                  {/* Progress + status */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span
                        className={clsx(
                          'rounded-full border px-2 py-0.5 font-semibold',
                          STATUS_TONE[status],
                        )}
                      >
                        {releaseStatusLabel(status)}
                      </span>
                      <span className="font-bold text-foreground">
                        {progress}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className={clsx(
                          'h-full transition-all',
                          status === 'RELEASED'
                            ? 'bg-emerald-500'
                            : status === 'DELAYED'
                              ? 'bg-rose-500'
                              : status === 'AT_RISK'
                                ? 'bg-amber-500'
                                : 'bg-indigo-500',
                        )}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Scope items compact */}
                  <div className="rounded-md bg-subtle/50 p-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {r.scopeMode === 'EPIC'
                        ? `${r.epics.length} ${r.epics.length === 1 ? 'epic' : 'epics'}`
                        : `${r.sprints.length} ${r.sprints.length === 1 ? 'sprint' : 'sprints'}`}
                    </div>
                    {r.scopeMode === 'EPIC' && r.epics.length > 0 ? (
                      <ul className="space-y-0.5">
                        {r.epics.slice(0, 4).map((e) => (
                          <li
                            key={e.id}
                            className="flex items-center gap-1.5 text-[11px] text-foreground"
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: e.color }}
                              aria-hidden
                            />
                            <span className="flex-1 truncate">{e.name}</span>
                            <span className="shrink-0 text-muted-foreground tabular-nums">
                              {e.progressPct}%
                            </span>
                          </li>
                        ))}
                        {r.epics.length > 4 && (
                          <li className="text-[10px] italic text-muted-foreground">
                            + {r.epics.length - 4} más
                          </li>
                        )}
                      </ul>
                    ) : r.scopeMode === 'SPRINT' && r.sprints.length > 0 ? (
                      <ul className="space-y-0.5">
                        {r.sprints.slice(0, 4).map((s) => (
                          <li
                            key={s.id}
                            className="flex items-center gap-1.5 text-[11px] text-foreground"
                          >
                            <Rocket className="h-2.5 w-2.5 text-muted-foreground" />
                            <span className="flex-1 truncate">{s.name}</span>
                            <span className="shrink-0 text-muted-foreground tabular-nums">
                              {s.progressPct}%
                            </span>
                          </li>
                        ))}
                        {r.sprints.length > 4 && (
                          <li className="text-[10px] italic text-muted-foreground">
                            + {r.sprints.length - 4} más
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-[10px] italic text-muted-foreground">
                        Sin scope asignado.
                      </p>
                    )}
                  </div>

                  {/* Footer */}
                  <footer className="flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {r.ownerName ?? 'Sin owner'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {r.releasedDate
                        ? `Liberada ${new Date(r.releasedDate).toLocaleDateString()}`
                        : days < 0
                          ? `Atraso ${Math.abs(days)}d`
                          : days === 0
                            ? 'Hoy'
                            : `${days}d restantes`}
                    </span>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </div>

      <NewReleaseModal
        open={showNew}
        onClose={() => setShowNew(false)}
        projectId={project.id}
        projectName={project.name}
        users={users}
        epics={epics}
        sprints={sprints}
      />

      {editing && (
        <NewReleaseModal
          open={true}
          onClose={() => setEditing(null)}
          projectId={project.id}
          projectName={project.name}
          users={users}
          epics={epics}
          sprints={sprints}
          initial={editingInitial(editing)}
        />
      )}
    </>
  )
}
