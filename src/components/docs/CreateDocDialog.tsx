'use client'

/**
 * Ola P2 · Equipo P2-5 — Diálogo de creación rápida de doc.
 *
 * Sólo título + parent opcional. El contenido se llena en el editor tras
 * la redirección. Mantenemos el shape mínimo para no bloquear al usuario.
 */

import { useState, useTransition } from 'react'
import { X, FileText } from 'lucide-react'
import { createDoc } from '@/lib/actions/docs'

type ParentOption = { id: string; title: string }

type Props = {
  open: boolean
  onClose: () => void
  /** Lista de candidatos a parent (docs no archivados). */
  parentOptions: ParentOption[]
  /** Parent preseleccionado (ej. desde context-menu). */
  defaultParentId?: string | null
  /** Project preseleccionado (ej. desde la project page). */
  defaultProjectId?: string | null
  /** Task preseleccionada (ej. desde el task drawer). */
  defaultTaskId?: string | null
  /** Callback con el id del nuevo doc. */
  onCreated?: (id: string) => void
}

export function CreateDocDialog({
  open,
  onClose,
  parentOptions,
  defaultParentId = null,
  defaultProjectId = null,
  defaultTaskId = null,
  onCreated,
}: Props) {
  const [title, setTitle] = useState('')
  const [parentId, setParentId] = useState<string | ''>(defaultParentId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) {
      setError('El título es obligatorio')
      return
    }
    start(async () => {
      try {
        const out = await createDoc({
          title: title.trim(),
          parentId: parentId || null,
          projectId: defaultProjectId,
          taskId: defaultTaskId,
        })
        setTitle('')
        onCreated?.(out.id)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="create-doc-dialog"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileText className="h-4 w-4 text-primary" />
            Nuevo documento
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="doc-create-title"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Título
            </label>
            <input
              id="doc-create-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              placeholder="Ej. Arquitectura AWS TO-BE"
            />
          </div>

          <div>
            <label
              htmlFor="doc-create-parent"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Documento padre (opcional)
            </label>
            <select
              id="doc-create-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">— Raíz —</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-500" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {pending ? 'Creando…' : 'Crear documento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
