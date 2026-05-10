'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
import {
  createAdminGerencia,
  updateAdminGerencia,
  deleteAdminGerencia,
} from '@/lib/actions/admin'

export type AdminGerenciaRow = {
  id: string
  name: string
  description: string | null
  createdAt: string
  areaCount: number
  projectCount: number
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[[A-Z_]+\]\s*/, '')
  }
  return 'Error desconocido'
}

export function AdminGerenciasClient({
  initial,
}: {
  initial: AdminGerenciaRow[]
}) {
  const router = useRouter()
  const [openDialog, setOpenDialog] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; row: AdminGerenciaRow }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleDelete = (row: AdminGerenciaRow) => {
    if (
      !confirm(
        `¿Eliminar la gerencia "${row.name}"? Solo posible si no tiene proyectos activos.`,
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await deleteAdminGerencia({ id: row.id })
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
          Nueva gerencia
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {initial.map((g) => (
          <div
            key={g.id}
            className="rounded-2xl border border-border bg-card/40 p-5 transition-colors hover:border-emerald-500/30"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-semibold text-foreground">
                  {g.name}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {g.description ?? 'Sin descripción'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    setOpenDialog({ mode: 'edit', row: g })
                  }}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors"
                  aria-label={`Editar ${g.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(g)}
                  disabled={isPending}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
                  aria-label={`Eliminar ${g.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">{g.areaCount}</strong>{' '}
                áreas
              </span>
              <span>
                <strong className="text-foreground">{g.projectCount}</strong>{' '}
                proyectos
              </span>
            </div>

            <Link
              href={`/admin/gerencias/${g.id}`}
              className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              Gestionar áreas
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        ))}

        {initial.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 rounded-2xl border border-dashed border-border bg-card/20 p-12 text-center text-sm text-muted-foreground">
            No hay gerencias registradas. Crea la primera con el botón superior.
          </div>
        )}
      </div>

      {openDialog && (
        <GerenciaDialog
          state={openDialog}
          onClose={() => setOpenDialog(null)}
          onError={setError}
        />
      )}
    </div>
  )
}

function GerenciaDialog({
  state,
  onClose,
  onError,
}: {
  state:
    | { mode: 'create' }
    | { mode: 'edit'; row: AdminGerenciaRow }
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
          await createAdminGerencia({
            name: name.trim(),
            description: description.trim() || null,
          })
        } else {
          await updateAdminGerencia({
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
      aria-labelledby="ger-dialog-title"
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
          id="ger-dialog-title"
          className="mb-4 text-lg font-semibold text-foreground"
        >
          {state.mode === 'create' ? 'Crear gerencia' : 'Editar gerencia'}
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
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm uppercase text-foreground focus:border-emerald-500 focus:outline-none"
              placeholder="OPERACIONES"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Se guardará en mayúsculas.
            </span>
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
