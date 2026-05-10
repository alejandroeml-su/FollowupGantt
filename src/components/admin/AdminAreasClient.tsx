'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import {
  createAdminArea,
  updateAdminArea,
  deleteAdminArea,
} from '@/lib/actions/admin'

export type AdminAreaRow = {
  id: string
  name: string
  description: string | null
  createdAt: string
  projectCount: number
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[[A-Z_]+\]\s*/, '')
  }
  return 'Error desconocido'
}

export function AdminAreasClient({
  gerenciaId,
  initial,
}: {
  gerenciaId: string
  initial: AdminAreaRow[]
}) {
  const router = useRouter()
  const [openDialog, setOpenDialog] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; row: AdminAreaRow }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleDelete = (row: AdminAreaRow) => {
    if (
      !confirm(
        `¿Eliminar el área "${row.name}"? Solo posible si no tiene proyectos activos.`,
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await deleteAdminArea({ id: row.id })
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
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nueva área
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
              <th className="px-4 py-3 font-semibold">Nombre</th>
              <th className="px-4 py-3 font-semibold">Descripción</th>
              <th className="px-4 py-3 font-semibold">Proyectos</th>
              <th className="px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium text-foreground">
                  {a.name}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {a.description ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm">{a.projectCount}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setOpenDialog({ mode: 'edit', row: a })
                      }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors"
                      aria-label={`Editar ${a.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(a)}
                      disabled={isPending}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
                      aria-label={`Eliminar ${a.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {initial.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  No hay áreas en esta gerencia. Crea la primera.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {openDialog && (
        <AreaDialog
          gerenciaId={gerenciaId}
          state={openDialog}
          onClose={() => setOpenDialog(null)}
          onError={setError}
        />
      )}
    </div>
  )
}

function AreaDialog({
  gerenciaId,
  state,
  onClose,
  onError,
}: {
  gerenciaId: string
  state:
    | { mode: 'create' }
    | { mode: 'edit'; row: AdminAreaRow }
  onClose: () => void
  onError: (msg: string | null) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState(state.mode === 'edit' ? state.row.name : '')
  const [description, setDescription] = useState(
    state.mode === 'edit' ? (state.row.description ?? '') : '',
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onError(null)
    startTransition(async () => {
      try {
        if (state.mode === 'create') {
          await createAdminArea({
            name: name.trim(),
            description: description.trim() || null,
            gerenciaId,
          })
        } else {
          await updateAdminArea({
            id: state.row.id,
            name: name.trim(),
            description: description.trim() || null,
            gerenciaId,
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
      aria-labelledby="area-dialog-title"
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
          id="area-dialog-title"
          className="mb-4 text-lg font-semibold text-foreground"
        >
          {state.mode === 'create' ? 'Crear área' : 'Editar área'}
        </h2>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/90">
              Nombre
            </span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
              placeholder="Desarrollo"
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
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
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
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
