'use client'

/**
 * Ola P1 · Equipo 3 — Shell client del admin de Custom Fields por proyecto.
 *
 * Recibe del Server Component padre la lista inicial de definiciones (ya
 * leídas vía `getFieldDefsForProject`) y expone:
 *   - botón "Crear campo" que abre `<FieldDefForm/>` en un modal liviano.
 *   - lista interactiva `<FieldsList/>` con reordenar/editar/eliminar.
 *
 * Tras cada mutación, los server actions ya disparan `revalidatePath` y el
 * router de Next refresca el árbol; aquí cerramos el modal y dejamos que
 * `useRouter().refresh()` (implícito a `revalidatePath`) traiga la lista
 * fresca del Server Component padre.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { FieldDefForm, type FieldDefDraft } from './FieldDefForm'
import { FieldsList, type FieldDefRow } from './FieldsList'

type Props = {
  projectId: string
  initialFields: FieldDefRow[]
  /** Definiciones completas (incluye options) para el modal de edición. */
  initialDrafts: Record<string, FieldDefDraft>
}

export function ProjectFieldsAdmin({
  projectId,
  initialFields,
  initialDrafts,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const closeModal = () => {
    setOpen(false)
    setEditingId(null)
  }

  const handleSaved = () => {
    closeModal()
    // El server action invocó `revalidatePath`; `router.refresh` fuerza un
    // re-render del segmento que vuelve a llamar al Server Component padre.
    router.refresh()
  }

  const editingDraft =
    editingId && initialDrafts[editingId] ? initialDrafts[editingId] : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Campos personalizados
          </h2>
          <p className="text-sm text-muted-foreground">
            Define metadatos extra que aplicarán a todas las tareas del proyecto.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingId(null)
            setOpen(true)
          }}
          data-testid="custom-field-create-button"
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20"
        >
          <Plus className="h-4 w-4" /> Crear campo
        </button>
      </div>

      <FieldsList
        fields={initialFields}
        onEdit={(id) => {
          setEditingId(id)
          setOpen(true)
        }}
      />

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? 'Editar campo' : 'Crear campo'}
        >
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
              <h3 className="text-base font-bold text-foreground">
                {editingId ? 'Editar campo personalizado' : 'Crear campo personalizado'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Cerrar"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <FieldDefForm
              projectId={projectId}
              initial={editingDraft ?? undefined}
              onSaved={handleSaved}
              onCancel={closeModal}
            />
          </div>
        </div>
      )}
    </div>
  )
}
