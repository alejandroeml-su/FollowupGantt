'use client'

/**
 * Toolbar contextual visible cuando hay tareas seleccionadas en la
 * vista de Lista. Permite operaciones bulk:
 *   - Cambiar estado a TODO/IN_PROGRESS/DONE
 *   - Archivar
 *   - Eliminar (con confirm)
 *   - Limpiar selección
 */

import { useTransition } from 'react'
import { Trash2, Archive, X, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { toast } from './Toaster'
import {
  bulkDelete,
  bulkArchive,
  bulkMoveTasksWithStatus,
} from '@/lib/actions/reorder'

interface Props {
  count: number
  selectedIds: Set<string>
  onClear: () => void
  onSelectAllVisible: () => void
  visibleCount: number
}

export function BulkActionsToolbar({
  count,
  selectedIds,
  onClear,
  onSelectAllVisible,
  visibleCount,
}: Props) {
  const [pending, startTx] = useTransition()
  const ids = () => Array.from(selectedIds)

  function handleStatus(status: 'TODO' | 'IN_PROGRESS' | 'DONE') {
    startTx(async () => {
      try {
        const r = await bulkMoveTasksWithStatus(ids(), status, null, null)
        toast.success(`${r.updated} tarea${r.updated === 1 ? '' : 's'} actualizadas`)
        onClear()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al actualizar')
      }
    })
  }

  function handleArchive() {
    if (!window.confirm(`¿Archivar ${count} tarea${count === 1 ? '' : 's'}?`)) return
    startTx(async () => {
      try {
        const r = await bulkArchive(ids())
        toast.success(`${r.updated} tarea${r.updated === 1 ? '' : 's'} archivadas`)
        onClear()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al archivar')
      }
    })
  }

  function handleDelete() {
    if (
      !window.confirm(
        `¿Eliminar ${count} tarea${count === 1 ? '' : 's'} permanentemente? Esta acción no se puede deshacer.`,
      )
    ) {
      return
    }
    startTx(async () => {
      try {
        const r = await bulkDelete(ids())
        toast.success(`${r.deleted} tarea${r.deleted === 1 ? '' : 's'} eliminadas`)
        onClear()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al eliminar')
      }
    })
  }

  return (
    <div
      role="toolbar"
      aria-label="Acciones para tareas seleccionadas"
      className="flex items-center gap-2 border-b border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-xs"
      data-testid="bulk-actions-toolbar"
    >
      <span className="font-semibold text-indigo-400">
        {count} seleccionada{count === 1 ? '' : 's'}
      </span>

      {count < visibleCount ? (
        <button
          type="button"
          onClick={onSelectAllVisible}
          className="rounded px-2 py-0.5 text-indigo-400 hover:bg-indigo-500/20"
          disabled={pending}
        >
          Seleccionar las {visibleCount} visibles
        </button>
      ) : null}

      <span className="mx-2 h-4 w-px bg-border" aria-hidden />

      <button
        type="button"
        onClick={() => handleStatus('TODO')}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 hover:bg-secondary disabled:opacity-50"
      >
        <Circle className="h-3 w-3" /> A hacer
      </button>
      <button
        type="button"
        onClick={() => handleStatus('IN_PROGRESS')}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 hover:bg-secondary disabled:opacity-50"
      >
        <Loader2 className="h-3 w-3" /> En curso
      </button>
      <button
        type="button"
        onClick={() => handleStatus('DONE')}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 hover:bg-secondary disabled:opacity-50"
      >
        <CheckCircle2 className="h-3 w-3" /> Completar
      </button>

      <span className="mx-2 h-4 w-px bg-border" aria-hidden />

      <button
        type="button"
        onClick={handleArchive}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 hover:bg-secondary disabled:opacity-50"
      >
        <Archive className="h-3 w-3" /> Archivar
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
      >
        <Trash2 className="h-3 w-3" /> Eliminar
      </button>

      <button
        type="button"
        onClick={onClear}
        disabled={pending}
        className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-secondary disabled:opacity-50"
        aria-label="Limpiar selección"
      >
        <X className="h-3 w-3" /> Limpiar
      </button>
    </div>
  )
}
