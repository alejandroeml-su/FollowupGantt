'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Plus, X } from 'lucide-react'
import { clsx } from 'clsx'
import {
  addTaskCollaborator,
  removeTaskCollaborator,
} from '@/lib/actions/collaborators'
import { toast } from '../Toaster'

export type CollaboratorOption = { id: string; name: string }

type Props = {
  /**
   * `create`: el control se renderiza pero deshabilitado con leyenda
   *           "Disponible al guardar" — la M:N requiere `taskId` real.
   * `edit`:  funcional contra los server actions de Sprint 4.
   */
  mode: 'create' | 'edit'
  taskId?: string
  assigneeId?: string | null
  /** Lista inicial (Server Component) y "fuente de verdad" optimista. */
  collaborators: CollaboratorOption[]
  /** Catálogo completo de usuarios para el popover de añadir. */
  users: CollaboratorOption[]
  className?: string
}

const FIELD_LABEL =
  'text-xs font-semibold uppercase tracking-wider text-muted-foreground'

const AVATAR_BASE =
  'inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-foreground border border-border text-[10px] font-bold uppercase'

const MAX_VISIBLE = 5

/**
 * Sección "Colaboradores" del sidebar del formulario de tareas (Sprint 4).
 *
 * Optimista: ante click en añadir/quitar, mutamos el estado local y
 * disparamos el server action en background. Si el action falla,
 * revertimos y disparamos toast de error. Si el modo es `create`, sólo
 * mostramos el control deshabilitado con la leyenda esperada.
 */
export function CollaboratorsField({
  mode,
  taskId,
  assigneeId,
  collaborators: initial,
  users,
  className,
}: Props) {
  const [items, setItems] = useState<CollaboratorOption[]>(initial)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Cierra popovers al click fuera.
  useEffect(() => {
    if (!popoverOpen && !activeId) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
        setActiveId(null)
      }
    }
    window.addEventListener('mousedown', onDoc)
    return () => window.removeEventListener('mousedown', onDoc)
  }, [popoverOpen, activeId])

  // Sincroniza con la prop cuando el padre cambia (p.ej. tras revalidate
  // del server después de mutar). Suprimimos la regla "set-state-in-effect"
  // porque el patrón es la lectura externa: la prop es la fuente de verdad
  // del server tras revalidate; el `useState` arriba es sólo el buffer
  // optimista local entre clic y respuesta.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setItems(initial)
  }, [initial])
  /* eslint-enable react-hooks/set-state-in-effect */

  const availableUsers = useMemo(() => {
    const taken = new Set(items.map((c) => c.id))
    if (assigneeId) taken.add(assigneeId)
    return users.filter((u) => !taken.has(u.id))
  }, [items, users, assigneeId])

  const visible = items.slice(0, MAX_VISIBLE)
  const overflow = items.length - visible.length

  const isCreate = mode === 'create'

  const handleAdd = (userId: string) => {
    if (!taskId) return
    const user = users.find((u) => u.id === userId)
    if (!user) return
    // Optimista: añade y revierte si falla.
    setItems((prev) => [...prev, user])
    setPopoverOpen(false)
    startTransition(async () => {
      try {
        await addTaskCollaborator(taskId, userId)
        toast.success(`Añadido ${user.name} como colaborador`)
      } catch (err) {
        setItems((prev) => prev.filter((c) => c.id !== userId))
        toast.error(
          err instanceof Error
            ? err.message.replace(/^\[[A-Z_]+\]\s*/, '')
            : 'No se pudo añadir colaborador',
        )
      }
    })
  }

  const handleRemove = (userId: string) => {
    if (!taskId) return
    const prevItems = items
    setItems((p) => p.filter((c) => c.id !== userId))
    setActiveId(null)
    startTransition(async () => {
      try {
        await removeTaskCollaborator(taskId, userId)
        toast.success('Colaborador retirado')
      } catch (err) {
        setItems(prevItems)
        toast.error(
          err instanceof Error
            ? err.message.replace(/^\[[A-Z_]+\]\s*/, '')
            : 'No se pudo retirar el colaborador',
        )
      }
    })
  }

  return (
    <div ref={wrapperRef} className={clsx('relative space-y-1.5', className)}>
      <label className={FIELD_LABEL}>Colaboradores</label>

      {/* Avatares */}
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map((c) => {
          const initial = c.name?.charAt(0) || '?'
          return (
            <button
              key={c.id}
              type="button"
              disabled={isCreate}
              onClick={() => setActiveId(activeId === c.id ? null : c.id)}
              title={c.name}
              aria-label={`Colaborador ${c.name}`}
              className={clsx(
                AVATAR_BASE,
                'transition-all hover:ring-2 hover:ring-ring focus:outline-none focus:ring-2 focus:ring-ring',
                isCreate && 'cursor-not-allowed opacity-60',
              )}
            >
              {initial}
            </button>
          )
        })}
        {overflow > 0 && (
          <span
            className={clsx(AVATAR_BASE, 'cursor-default')}
            title={items
              .slice(MAX_VISIBLE)
              .map((c) => c.name)
              .join(', ')}
          >
            +{overflow}
          </span>
        )}

        {/* Botón añadir */}
        <button
          type="button"
          onClick={() => !isCreate && setPopoverOpen((v) => !v)}
          disabled={isCreate || isPending || availableUsers.length === 0}
          aria-label="Añadir colaborador"
          className={clsx(
            'inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border bg-card text-muted-foreground transition-colors',
            !isCreate &&
              availableUsers.length > 0 &&
              'hover:border-primary hover:text-primary',
            (isCreate || availableUsers.length === 0) &&
              'cursor-not-allowed opacity-60',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Popover de detalle/quitar (modo edit) */}
      {!isCreate && activeId && (() => {
        const c = items.find((x) => x.id === activeId)
        if (!c) return null
        return (
          <div
            role="dialog"
            aria-label={`Detalle de ${c.name}`}
            className="absolute z-20 mt-2 w-56 rounded-md border border-border bg-card p-3 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <span className={AVATAR_BASE}>{c.name?.charAt(0) || '?'}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {c.name}
                </p>
                <p className="text-[11px] text-muted-foreground">Colaborador</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleRemove(c.id)}
              disabled={isPending}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-60"
            >
              <X className="h-3 w-3" /> Quitar
            </button>
          </div>
        )
      })()}

      {/* Popover de añadir (modo edit) */}
      {!isCreate && popoverOpen && (
        <div
          role="dialog"
          aria-label="Añadir colaborador"
          className="absolute z-20 mt-2 w-56 rounded-md border border-border bg-card p-2 shadow-lg"
        >
          {availableUsers.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No quedan usuarios disponibles.
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {availableUsers.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => handleAdd(u.id)}
                    disabled={isPending}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent disabled:opacity-60"
                  >
                    <span className={AVATAR_BASE}>
                      {u.name?.charAt(0) || '?'}
                    </span>
                    <span className="truncate">{u.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isCreate && (
        <p className="text-[11px] italic text-muted-foreground">
          Disponible al guardar.
        </p>
      )}
    </div>
  )
}
