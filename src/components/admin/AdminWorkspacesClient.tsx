'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Archive, ArchiveRestore } from 'lucide-react'
import {
  createAdminWorkspace,
  updateAdminWorkspace,
  archiveAdminWorkspace,
} from '@/lib/actions/admin'

/**
 * Wave P17-C · Tabla cliente del CRUD de workspaces (panel admin).
 * Maneja estado local + dialog de crear/editar.
 */

export type AdminWorkspaceRow = {
  id: string
  name: string
  slug: string
  description: string | null
  plan: string
  ownerName: string | null
  ownerEmail: string | null
  createdAt: string
  archivedAt: string | null
  memberCount: number
  projectCount: number
}

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 40)
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[[A-Z_]+\]\s*/, '')
  }
  return 'Error desconocido'
}

export function AdminWorkspacesClient({
  initialWorkspaces,
}: {
  initialWorkspaces: AdminWorkspaceRow[]
}) {
  const router = useRouter()
  const [openDialog, setOpenDialog] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; row: AdminWorkspaceRow }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleArchive = (row: AdminWorkspaceRow) => {
    if (
      !confirm(
        `¿Archivar el workspace "${row.name}"? Quedará oculto pero los datos se conservan.`,
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await archiveAdminWorkspace({ id: row.id })
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setError(null)
            setOpenDialog({ mode: 'create' })
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nuevo workspace
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
        <table className="w-full text-sm">
          <thead className="bg-subtle/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Workspace</th>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold">Proyectos</th>
              <th className="px-4 py-3 font-semibold">Miembros</th>
              <th className="px-4 py-3 font-semibold">Creado</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initialWorkspaces.map((w) => (
              <tr
                key={w.id}
                className={`border-t border-border ${w.archivedAt ? 'opacity-60' : ''}`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{w.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    /{w.slug}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm">{w.ownerName ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">
                    {w.ownerEmail ?? '—'}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">{w.projectCount}</td>
                <td className="px-4 py-3 text-sm">{w.memberCount}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(w.createdAt).toLocaleDateString('es-MX')}
                </td>
                <td className="px-4 py-3">
                  {w.archivedAt ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs text-zinc-300">
                      <Archive className="h-3 w-3" />
                      Archivado
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                      Activo
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setOpenDialog({ mode: 'edit', row: w })
                      }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors"
                      aria-label={`Editar ${w.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {!w.archivedAt && (
                      <button
                        type="button"
                        onClick={() => handleArchive(w)}
                        disabled={isPending}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-amber-500/20 hover:text-amber-300 transition-colors disabled:opacity-50"
                        aria-label={`Archivar ${w.name}`}
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    )}
                    {w.archivedAt && (
                      <span
                        className="rounded-md p-1.5 text-muted-foreground/50"
                        title="Restauración no implementada en P17-C"
                      >
                        <ArchiveRestore className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {initialWorkspaces.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  No hay workspaces registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openDialog && (
        <WorkspaceDialog
          state={openDialog}
          onClose={() => setOpenDialog(null)}
          onError={setError}
        />
      )}
    </div>
  )
}

function WorkspaceDialog({
  state,
  onClose,
  onError,
}: {
  state:
    | { mode: 'create' }
    | { mode: 'edit'; row: AdminWorkspaceRow }
  onClose: () => void
  onError: (msg: string | null) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const initial =
    state.mode === 'edit'
      ? state.row
      : { name: '', slug: '', description: '' as string | null }

  const [name, setName] = useState(initial.name)
  const [slug, setSlug] = useState(state.mode === 'edit' ? state.row.slug : '')
  const [touchedSlug, setTouchedSlug] = useState(state.mode === 'edit')
  const [description, setDescription] = useState(initial.description ?? '')

  const handleNameChange = (v: string) => {
    setName(v)
    if (state.mode === 'create' && !touchedSlug) {
      setSlug(deriveSlug(v))
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    startTransition(async () => {
      try {
        if (state.mode === 'create') {
          await createAdminWorkspace({
            name: name.trim(),
            slug: slug.trim(),
            description: description.trim() || null,
          })
        } else {
          await updateAdminWorkspace({
            id: state.row.id,
            name: name.trim(),
            description: description.trim() || null,
          })
        }
        onClose()
        router.refresh()
      } catch (err) {
        onError(extractErrorMessage(err))
      }
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ws-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2
          id="ws-dialog-title"
          className="mb-4 text-lg font-semibold text-foreground"
        >
          {state.mode === 'create'
            ? 'Crear workspace'
            : `Editar "${state.row.name}"`}
        </h2>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              Nombre
            </span>
            <input
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              maxLength={80}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-indigo-500 focus:outline-none"
              placeholder="Ej: Avante TI"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              Slug (URL)
              {state.mode === 'edit' && (
                <span className="ml-2 text-muted-foreground">
                  · solo lectura tras crear
                </span>
              )}
            </span>
            <input
              required
              disabled={state.mode === 'edit'}
              value={slug}
              onChange={(e) => {
                setTouchedSlug(true)
                setSlug(e.target.value.toLowerCase())
              }}
              maxLength={40}
              pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-indigo-500 focus:outline-none disabled:opacity-60"
              placeholder="avante-ti"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              Descripción
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-indigo-500 focus:outline-none"
              placeholder="Opcional"
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors"
            disabled={isPending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
          >
            {isPending
              ? 'Guardando…'
              : state.mode === 'create'
                ? 'Crear'
                : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
