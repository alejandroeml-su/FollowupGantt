'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Presentation, Plus, Archive, Trash2, FolderOpen, User, Clock } from 'lucide-react'
import { createWhiteboard, archiveWhiteboard, deleteWhiteboard } from '@/lib/actions/whiteboards'
import { toast } from '@/components/interactions/Toaster'
import type { WhiteboardListItem } from '@/lib/whiteboards/types'

type Props = {
  whiteboards: WhiteboardListItem[]
  projects: { id: string; name: string }[]
}

/**
 * Cliente de la lista `/whiteboards`. Server-component padre se encarga
 * del fetch (con `unstable_cache`); aquí solo manejamos la creación y
 * archive/delete para mantener la página rápida.
 */
export function WhiteboardListClient({ whiteboards, projects }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', projectId: '' })

  const openCreate = () => {
    setForm({ title: '', description: '', projectId: '' })
    setCreating(true)
  }

  const submitCreate = () => {
    if (!form.title.trim()) {
      toast.error('El título es obligatorio')
      return
    }
    startTransition(async () => {
      try {
        const created = await createWhiteboard({
          title: form.title,
          description: form.description || null,
          projectId: form.projectId || null,
        })
        toast.success('Pizarra creada')
        setCreating(false)
        router.push(`/whiteboards/${created.id}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al crear pizarra')
      }
    })
  }

  const handleArchive = (id: string, title: string) => {
    if (!window.confirm(`¿Archivar la pizarra "${title}"? Podrás restaurarla luego.`)) return
    startTransition(async () => {
      try {
        await archiveWhiteboard(id)
        toast.success('Pizarra archivada')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al archivar')
      }
    })
  }

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`¿Eliminar definitivamente la pizarra "${title}"? Esta acción es irreversible.`))
      return
    startTransition(async () => {
      try {
        await deleteWhiteboard(id)
        toast.success('Pizarra eliminada')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al eliminar')
      }
    })
  }

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openCreate}
          disabled={isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-all shadow-md disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Nueva pizarra
        </button>
      </div>

      {whiteboards.length === 0 ? (
        <div
          role="status"
          className="rounded-2xl border-2 border-dashed border-border bg-subtle/40 p-12 text-center space-y-4"
        >
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Presentation className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-base font-semibold text-foreground">Aún no hay pizarras</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Crea tu primera pizarra para colaborar visualmente: sticky notes, formas y conectores en un canvas infinito.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {whiteboards.map((wb) => (
            <article
              key={wb.id}
              data-testid={`whiteboard-card-${wb.id}`}
              className={`group relative bg-card border border-border rounded-xl p-5 hover:border-primary/50 hover:shadow-lg transition-all ${
                wb.isArchived ? 'opacity-60' : ''
              }`}
            >
              <Link
                href={`/whiteboards/${wb.id}`}
                className="absolute inset-0 rounded-xl"
                aria-label={`Abrir ${wb.title}`}
              />
              <div className="relative flex items-start justify-between gap-3 mb-3">
                <Presentation className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <h3 className="flex-1 text-base font-semibold text-foreground line-clamp-2">{wb.title}</h3>
              </div>
              {wb.description && (
                <p className="relative text-sm text-muted-foreground line-clamp-2 mb-3">
                  {wb.description}
                </p>
              )}
              <dl className="relative grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                {wb.projectName && (
                  <div className="flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span className="truncate" title={wb.projectName}>
                      {wb.projectName}
                    </span>
                  </div>
                )}
                {wb.createdByName && (
                  <div className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    <span className="truncate">{wb.createdByName}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{new Date(wb.updatedAt).toLocaleDateString('es-MX')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span>{wb.elementCount} elementos</span>
                </div>
              </dl>
              <div className="relative mt-4 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {!wb.isArchived && (
                  <button
                    type="button"
                    onClick={() => handleArchive(wb.id, wb.title)}
                    disabled={isPending}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Archivar ${wb.title}`}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(wb.id, wb.title)}
                  disabled={isPending}
                  className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                  aria-label={`Eliminar ${wb.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {creating && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wb-create-title"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg bg-card border border-border rounded-2xl p-6 space-y-4 shadow-2xl">
            <h2 id="wb-create-title" className="text-lg font-semibold text-foreground">
              Nueva pizarra
            </h2>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Título</span>
                <input
                  autoFocus
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Ej. Brainstorm Q3"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Descripción</span>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                  placeholder="Opcional"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Proyecto (opcional)</span>
                <select
                  value={form.projectId}
                  onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
                  className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">— Sin proyecto —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                disabled={isPending}
                className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={isPending}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                Crear pizarra
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
