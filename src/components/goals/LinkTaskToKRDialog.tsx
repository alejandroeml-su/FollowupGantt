'use client'

/**
 * Ola P2 · Equipo P2-4 — Dialog para vincular una tarea existente a un
 * Key Result de tipo TASKS_COMPLETED.
 *
 * Recibe la lista completa de tasks ya cargada por el padre (server
 * component) para evitar otra round-trip. Filtro por título / mnemonic
 * en cliente. Al confirmar invoca `linkTaskToKeyResult`.
 *
 * Implementado con `<dialog>` HTML para cero deps adicionales (Radix está
 * disponible pero hace falta más boilerplate; el repo ya usa esta
 * estrategia en otros sitios).
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Link2, X } from 'lucide-react'
import { linkTaskToKeyResult } from '@/lib/actions/goals'

export type TaskOption = {
  id: string
  title: string
  mnemonic: string | null
  projectName: string | null
}

type Props = {
  krId: string
  open: boolean
  onClose: () => void
  tasks: TaskOption[]
  /** Ids de tareas ya vinculadas — se filtran del listado. */
  alreadyLinkedIds?: string[]
  onLinked?: (taskId: string) => void
}

export function LinkTaskToKRDialog({
  krId,
  open,
  onClose,
  tasks,
  alreadyLinkedIds = [],
  onLinked,
}: Props) {
  const [query, setQuery] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setError(null)
      // Microtask delay para evitar reflow al abrir el portal.
      const id = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [open])

  const linkedSet = useMemo(() => new Set(alreadyLinkedIds), [alreadyLinkedIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks
      .filter((t) => !linkedSet.has(t.id))
      .filter((t) => {
        if (!q) return true
        return (
          t.title.toLowerCase().includes(q) ||
          (t.mnemonic ?? '').toLowerCase().includes(q) ||
          (t.projectName ?? '').toLowerCase().includes(q)
        )
      })
      .slice(0, 30)
  }, [tasks, query, linkedSet])

  function handleLink(taskId: string) {
    setError(null)
    start(async () => {
      try {
        await linkTaskToKeyResult(krId, taskId)
        onLinked?.(taskId)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido')
      }
    })
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vincular tarea al resultado clave"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="link-task-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl">
        <header className="flex items-center justify-between border-b border-border pb-2">
          <h3 className="text-sm font-semibold text-foreground">
            Vincular tarea
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, mnemónico o proyecto…"
          className="mt-3 w-full rounded border border-border bg-background px-2 py-1 text-sm"
        />

        {error && (
          <p className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
            {error}
          </p>
        )}

        <ul className="mt-3 max-h-[320px] space-y-1 overflow-auto">
          {filtered.length === 0 ? (
            <li className="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              {query ? 'Sin resultados.' : 'No hay tareas disponibles.'}
            </li>
          ) : (
            filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => handleLink(t.id)}
                  disabled={pending}
                  className="flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-3 py-2 text-left text-xs hover:bg-accent disabled:opacity-50"
                  data-testid="link-task-option"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {t.mnemonic ? (
                        <>
                          <span className="font-mono text-muted-foreground">
                            {t.mnemonic}
                          </span>{' '}
                        </>
                      ) : null}
                      {t.title}
                    </p>
                    {t.projectName && (
                      <p className="text-[11px] text-muted-foreground">
                        {t.projectName}
                      </p>
                    )}
                  </div>
                  <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
