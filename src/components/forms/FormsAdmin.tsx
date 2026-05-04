'use client'

/**
 * Ola P5 · Equipo P5-5 — Cliente del listado admin `/settings/forms`.
 *
 * Permite:
 *  - Ver lista de formularios con conteo de submissions.
 *  - Toggle activo/inactivo.
 *  - Copiar URL pública.
 *  - Crear (modal simple).
 *  - Navegar al editor `/settings/forms/<id>/edit`.
 */

import { useState, useTransition } from 'react'
import {
  createForm,
  togglePublishForm,
  deleteForm,
  slugify,
} from '@/lib/actions/forms'

interface FormItem {
  id: string
  slug: string
  title: string
  isActive: boolean
  description: string | null
  project: { id: string; name: string } | null
  _count: { submissions: number }
  createdAt: Date
}

interface Props {
  initialForms: FormItem[]
}

export function FormsAdmin({ initialForms }: Props) {
  const [forms, setForms] = useState<FormItem[]>(initialForms)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function publicUrl(slug: string) {
    if (typeof window === 'undefined') return `/forms/${slug}`
    return `${window.location.origin}/forms/${slug}`
  }

  async function handleToggle(id: string) {
    startTransition(async () => {
      try {
        const updated = await togglePublishForm(id)
        setForms((prev) =>
          prev.map((f) => (f.id === id ? { ...f, isActive: updated.isActive } : f)),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cambiar estado')
      }
    })
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este formulario? Las submissions se conservarán pero no podrán recibirse nuevas.')) return
    startTransition(async () => {
      try {
        await deleteForm(id)
        setForms((prev) => prev.filter((f) => f.id !== id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al eliminar')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {forms.length} {forms.length === 1 ? 'formulario' : 'formularios'}
        </p>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Nuevo formulario
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      ) : null}

      <ul className="space-y-2">
        {forms.length === 0 ? (
          <li className="rounded-md border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
            Sin formularios. Crea el primero para empezar.
          </li>
        ) : null}
        {forms.map((f) => (
          <li
            key={f.id}
            className="rounded-md border border-border bg-card p-4 flex items-center gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground truncate">{f.title}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    f.isActive
                      ? 'bg-green-500/15 text-green-300'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {f.isActive ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                /forms/{f.slug} · {f._count.submissions} ejecuciones recibidas
                {f.project ? ` · Proyecto: ${f.project.name}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(publicUrl(f.slug))}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-secondary"
            >
              Copiar URL
            </button>
            <a
              href={`/settings/forms/${f.id}/edit`}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-secondary"
            >
              Editar
            </a>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleToggle(f.id)}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs hover:bg-secondary"
            >
              {f.isActive ? 'Despublicar' : 'Publicar'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleDelete(f.id)}
              className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs text-red-200 hover:bg-red-500/20"
            >
              Eliminar
            </button>
          </li>
        ))}
      </ul>

      {showNew ? (
        <NewFormDialog
          onClose={() => setShowNew(false)}
          onCreated={(item) => {
            setForms((prev) => [item, ...prev])
            setShowNew(false)
          }}
        />
      ) : null}
    </div>
  )
}

function NewFormDialog(props: {
  onClose: () => void
  onCreated: (item: FormItem) => void
}) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleCreate() {
    setError(null)
    const cleanSlug = slug || slugify(title)
    if (!title || !cleanSlug) {
      setError('Título y slug son obligatorios')
      return
    }
    startTransition(async () => {
      try {
        const created = await createForm({
          slug: cleanSlug,
          title,
          description: description || undefined,
          schema: [
            { name: 'nombre', type: 'text', label: 'Nombre', required: true },
            { name: 'email', type: 'email', label: 'Email', required: true },
            { name: 'mensaje', type: 'textarea', label: 'Mensaje', required: true },
          ],
          targetTaskTitleTemplate: `Submission de ${cleanSlug}: {nombre}`,
        })
        props.onCreated({
          id: created.id,
          slug: created.slug,
          title: created.title,
          description: created.description,
          isActive: created.isActive,
          project: null,
          _count: { submissions: 0 },
          createdAt: created.createdAt,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al crear')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-4">
        <h2 className="text-lg font-semibold text-white">Nuevo formulario</h2>
        <div>
          <label className="text-sm text-foreground/80">Título</label>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (!slug) setSlug(slugify(e.target.value))
            }}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Solicitud de soporte"
          />
        </div>
        <div>
          <label className="text-sm text-foreground/80">Slug</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            placeholder="solicitud-soporte"
          />
        </div>
        <div>
          <label className="text-sm text-foreground/80">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleCreate}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isPending ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  )
}
