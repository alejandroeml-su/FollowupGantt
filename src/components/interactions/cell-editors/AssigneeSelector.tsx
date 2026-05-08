'use client'

/**
 * Wave P9 follow-up — Selector de Assignee con búsqueda.
 *
 * Combobox compacto para edición inline desde la fila de `/list` y
 * otras vistas tabulares. Busca por nombre o email (case-insensitive).
 * Permite "Sin asignar" como primera opción para quitar assignee.
 */

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { Search, UserCircle2, Check, X as XIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { setTaskAssignee } from '@/lib/actions/inline-edit'
import { toast } from '@/components/interactions/Toaster'

export type AssigneeOption = {
  id: string
  name: string
  email?: string | null
}

type Props = {
  taskId: string
  currentAssignee: { id: string; name: string } | null
  users: AssigneeOption[]
  /** Si se pasa, se llama tras éxito en lugar de router.refresh. */
  onChanged?: (newAssigneeId: string | null) => void
  className?: string
}

export function AssigneeSelector({
  taskId,
  currentAssignee,
  users,
  onChanged,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [isPending, startTransition] = useTransition()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listId = useId()

  // Cerrar al click fuera.
  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // Auto-focus al abrir.
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus()
    }
  }, [open])

  const lowerQuery = query.trim().toLowerCase()
  const filtered = lowerQuery
    ? users.filter(
        (u) =>
          u.name.toLowerCase().includes(lowerQuery) ||
          (u.email ?? '').toLowerCase().includes(lowerQuery),
      )
    : users

  const handleSelect = (newAssigneeId: string | null) => {
    if (newAssigneeId === (currentAssignee?.id ?? null)) {
      setOpen(false)
      setQuery('')
      return
    }
    startTransition(async () => {
      try {
        await setTaskAssignee(taskId, newAssigneeId)
        toast.success(
          newAssigneeId
            ? `Asignado a ${users.find((u) => u.id === newAssigneeId)?.name ?? 'usuario'}`
            : 'Asignación removida',
        )
        onChanged?.(newAssigneeId)
        setOpen(false)
        setQuery('')
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Error al asignar',
        )
      }
    })
  }

  return (
    <div ref={wrapperRef} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        disabled={isPending}
        className={clsx(
          'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-secondary/60',
          isPending && 'opacity-60',
        )}
      >
        <UserCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span
          className={clsx(
            'truncate',
            currentAssignee ? 'text-foreground/90' : 'italic text-muted-foreground',
          )}
        >
          {currentAssignee?.name ?? 'Sin Asignar'}
        </span>
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1 w-64 rounded-md border border-border bg-card shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o email…"
              className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              aria-controls={listId}
            />
          </div>

          <ul
            id={listId}
            role="listbox"
            className="max-h-56 overflow-y-auto py-1"
          >
            {/* Sin asignar (primera opción) */}
            <li>
              <button
                type="button"
                onClick={() => handleSelect(null)}
                role="option"
                aria-selected={!currentAssignee}
                className={clsx(
                  'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-secondary',
                  !currentAssignee && 'bg-secondary/60',
                )}
              >
                <XIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="italic text-muted-foreground">
                  Sin asignar
                </span>
                {!currentAssignee && (
                  <Check className="ml-auto h-3.5 w-3.5 text-emerald-400" />
                )}
              </button>
            </li>

            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-center text-[11px] text-muted-foreground">
                Sin resultados
              </li>
            ) : (
              filtered.map((u) => {
                const isActive = u.id === currentAssignee?.id
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(u.id)}
                      role="option"
                      aria-selected={isActive}
                      className={clsx(
                        'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-secondary',
                        isActive && 'bg-secondary/60',
                      )}
                    >
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary-foreground/80">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-foreground">
                          {u.name}
                        </div>
                        {u.email && (
                          <div className="truncate text-[10px] text-muted-foreground">
                            {u.email}
                          </div>
                        )}
                      </div>
                      {isActive && (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      )}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
