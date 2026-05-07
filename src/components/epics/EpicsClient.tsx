'use client'

/**
 * Wave P9 · Agile Maturity (HU-9.1) — Vista lista de Epics por proyecto.
 *
 * @UIUX:
 *   - Header con breadcrumb (Project > Epics) + botón "Nueva Epic".
 *   - Cards en grid responsive (auto-fill, minmax(280px, 1fr)).
 *   - Empty state con CTA centrado.
 *   - Cada card muestra: badge color + nombre + status + owner +
 *     conteo Tasks + acciones (editar / archivar).
 */

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Archive, Calendar, User } from 'lucide-react'
import { clsx } from 'clsx'
import { archiveEpic } from '@/lib/actions/epics'
import { NewEpicModal } from './NewEpicModal'
import { EpicBadge } from './EpicBadge'
import { toast } from '@/components/interactions/Toaster'

export type EpicSerialized = {
  id: string
  name: string
  description: string | null
  color: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'
  ownerId: string | null
  ownerName: string | null
  plannedStartDate: string | null
  plannedEndDate: string | null
  taskCount: number
  archivedAt: string | null
}

type Props = {
  project: { id: string; name: string }
  epics: EpicSerialized[]
  users: { id: string; name: string }[]
}

const STATUS_CONFIG: Record<
  EpicSerialized['status'],
  { label: string; tone: string }
> = {
  PLANNED: { label: 'Planeada', tone: 'bg-secondary text-muted-foreground' },
  IN_PROGRESS: { label: 'En curso', tone: 'bg-indigo-500/15 text-indigo-300' },
  DONE: { label: 'Completada', tone: 'bg-emerald-500/15 text-emerald-300' },
  CANCELLED: { label: 'Cancelada', tone: 'bg-rose-500/15 text-rose-300' },
}

export default function EpicsClient({ project, epics, users }: Props) {
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<EpicSerialized | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)

  const handleArchive = async (id: string, name: string) => {
    if (!confirm(`¿Archivar la Epic "${name}"? Las Tasks asociadas mantienen el registro pero la Epic se oculta de los listados.`)) {
      return
    }
    setArchivingId(id)
    try {
      await archiveEpic({ id })
      toast.success('Epic archivada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al archivar')
    } finally {
      setArchivingId(null)
    }
  }

  return (
    <>
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Proyectos
          </Link>
          <h1 className="mt-1 text-xl font-bold text-foreground">
            {project.name} · Epics
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Iniciativas grandes que agrupan stories y tasks bajo un mismo paraguas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Nueva Epic
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {epics.length === 0 ? (
          <div className="mx-auto max-w-md rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <h2 className="text-base font-semibold text-foreground">
              Aún no hay Epics en este proyecto
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Crea tu primera Epic para empezar a agrupar Stories y Tasks bajo
              iniciativas reconocibles.
            </p>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Crear primera Epic
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {epics.map((epic) => {
              const statusConf = STATUS_CONFIG[epic.status]
              const isArchiving = archivingId === epic.id
              return (
                <article
                  key={epic.id}
                  className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <header className="flex items-start justify-between gap-2">
                    <EpicBadge
                      name={epic.name}
                      color={epic.color}
                      description={epic.description}
                      size="md"
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(epic)}
                        aria-label={`Editar ${epic.name}`}
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleArchive(epic.id, epic.name)}
                        disabled={isArchiving}
                        aria-label={`Archivar ${epic.name}`}
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </header>

                  {epic.description && (
                    <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                      {epic.description}
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between text-[11px]">
                    <span
                      className={clsx(
                        'rounded-full px-2 py-0.5 font-semibold',
                        statusConf.tone,
                      )}
                    >
                      {statusConf.label}
                    </span>
                    <span className="text-muted-foreground">
                      {epic.taskCount} {epic.taskCount === 1 ? 'tarea' : 'tareas'}
                    </span>
                  </div>

                  <footer className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
                    {epic.ownerName ? (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {epic.ownerName}
                      </span>
                    ) : (
                      <span>Sin owner</span>
                    )}
                    {epic.plannedEndDate && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(epic.plannedEndDate).toLocaleDateString()}
                      </span>
                    )}
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </div>

      <NewEpicModal
        open={showNew}
        onClose={() => setShowNew(false)}
        projectId={project.id}
        users={users}
      />

      {editing && (
        <NewEpicModal
          open={true}
          onClose={() => setEditing(null)}
          projectId={project.id}
          users={users}
          initial={{
            id: editing.id,
            name: editing.name,
            description: editing.description,
            color: editing.color,
            status: editing.status,
            ownerId: editing.ownerId,
            plannedStartDate: editing.plannedStartDate,
            plannedEndDate: editing.plannedEndDate,
          }}
        />
      )}
    </>
  )
}
