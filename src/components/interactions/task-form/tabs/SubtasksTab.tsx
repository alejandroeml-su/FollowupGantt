'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { CheckSquare, Plus, UserCircle2 } from 'lucide-react'
import type { SerializedTask } from '@/lib/types'
import {
  assignSubtaskInline,
  createSubtaskInline,
  getSubtasks,
  toggleSubtaskDone,
} from '@/lib/actions'
import { toast } from '../../Toaster'

type Props = {
  /** `null` = modo creación; el tab debe quedar en placeholder. */
  task: SerializedTask | null
  users: { id: string; name: string }[]
  /** Subtareas iniciales del padre (si las trae el server). */
  initialSubtasks?: SerializedTask[]
}

// Deuda: sin sesión real aún (mismo hack que el resto del módulo).
const DEBUG_USER_ROLES = ['SUPER_ADMIN']

/** Forma mínima persistente de una subtarea para el tab. */
type RowState = {
  id: string
  mnemonic: string | null
  title: string
  status: string
  assigneeId: string | null
}

function toRow(s: SerializedTask): RowState {
  return {
    id: s.id,
    mnemonic: s.mnemonic ?? null,
    title: s.title,
    status: s.status,
    assigneeId: s.assigneeId ?? s.assignee?.id ?? null,
  }
}

function initials(name: string | undefined | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '')
}

/**
 * Listado inline de subtareas con creación rápida (Enter), check para
 * cerrar y mini-selector de responsable.
 *
 * En modo creación (`task=null`) muestra el placeholder original — la
 * persistencia inline requiere `parentId`, así que no permitimos
 * creación pre-save.
 *
 * TODO Sprint posterior: botón `×` por fila para borrar subtarea.
 */
export function SubtasksTab({ task, users, initialSubtasks }: Props) {
  const inputId = useId()
  const isEditing = task !== null
  const [rows, setRows] = useState<RowState[]>(() => {
    const seed = initialSubtasks ?? task?.subtasks ?? []
    return seed.map(toRow)
  })
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [openAssigneeFor, setOpenAssigneeFor] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const newInputRef = useRef<HTMLInputElement | null>(null)

  // Carga lazy: si abrimos una tarea existente y no recibimos subtasks
  // (algunos call-sites del drawer no las incluyen), pedirlas al server.
  /* eslint-disable react-hooks/set-state-in-effect */
  // setState dentro de effect es intencional: es un fetch de sincronización
  // con el server, mismo patrón que `TaskCreationModal` (tags suggestions).
  useEffect(() => {
    if (!task) return
    if ((task.subtasks?.length ?? 0) > 0) return
    if ((initialSubtasks?.length ?? 0) > 0) return
    let cancelled = false
    setLoading(true)
    getSubtasks(task.id)
      .then((list) => {
        if (cancelled) return
        setRows(list.map(toRow))
      })
      .catch(() => {
        if (cancelled) return
        // Falla silenciosa: dejamos rows vacío (estado vacío estándar).
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [task, initialSubtasks])
  /* eslint-enable react-hooks/set-state-in-effect */

  const userMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users) m.set(u.id, u.name)
    return m
  }, [users])

  const total = rows.length
  const done = rows.filter((r) => r.status === 'DONE').length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  const barColor =
    percent === 100
      ? 'bg-success'
      : percent === 0
        ? 'bg-secondary'
        : 'bg-primary'

  const handleCreate = useCallback(() => {
    if (!task) return
    const title = draft.trim()
    if (!title) return
    startTransition(async () => {
      try {
        const created = await createSubtaskInline({
          parentId: task.id,
          title,
          userRoles: DEBUG_USER_ROLES,
        })
        setRows((prev) => [
          ...prev,
          {
            id: created.id,
            mnemonic: created.mnemonic ?? null,
            title: created.title,
            status: created.status,
            assigneeId: created.assigneeId ?? null,
          },
        ])
        setDraft('')
        // Mantener el foco para crear otra subtarea seguida.
        newInputRef.current?.focus()
        toast.success('Subtarea creada')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al crear subtarea'
        // Quitar prefijo `[CODE] ` si viene tipado.
        toast.error(msg.replace(/^\[[^\]]+\]\s*/, ''))
      }
    })
  }, [draft, task])

  const handleToggle = useCallback((row: RowState) => {
    if (!task) return
    const nextDone = row.status !== 'DONE'
    // Optimista: pintamos el cambio antes de awaitar.
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, status: nextDone ? 'DONE' : 'TODO' } : r,
      ),
    )
    startTransition(async () => {
      try {
        await toggleSubtaskDone({
          id: row.id,
          done: nextDone,
          userRoles: DEBUG_USER_ROLES,
        })
      } catch (err) {
        // Rollback ante error.
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)),
        )
        const msg = err instanceof Error ? err.message : 'No se pudo actualizar'
        toast.error(msg.replace(/^\[[^\]]+\]\s*/, ''))
      }
    })
  }, [task])

  const handleAssign = useCallback((row: RowState, assigneeId: string | null) => {
    if (!task) return
    const previous = row.assigneeId
    setRows((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, assigneeId } : r)),
    )
    setOpenAssigneeFor(null)
    startTransition(async () => {
      try {
        await assignSubtaskInline({
          id: row.id,
          assigneeId,
          userRoles: DEBUG_USER_ROLES,
        })
      } catch (err) {
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, assigneeId: previous } : r)),
        )
        const msg = err instanceof Error ? err.message : 'No se pudo reasignar'
        toast.error(msg.replace(/^\[[^\]]+\]\s*/, ''))
      }
    })
  }, [task])

  const handleDraftKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreate()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    }
  }

  // Cierra el popover de asignación al click fuera.
  useEffect(() => {
    if (!openAssigneeFor) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target && target.closest('[data-assignee-popover]')) return
      if (target && target.closest('[data-assignee-trigger]')) return
      setOpenAssigneeFor(null)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [openAssigneeFor])

  // Modo creación: placeholder coherente con el resto de tabs.
  if (!isEditing) {
    return (
      <div className="text-center py-12">
        <CheckSquare className="h-10 w-10 text-foreground mx-auto mb-2 opacity-30" />
        <p className="text-muted-foreground text-sm italic">
          Disponible al guardar la tarea.
        </p>
      </div>
    )
  }

  return (
    <section className="space-y-5">
      {/* Listado */}
      <div role="list" className="space-y-1.5">
        {loading && rows.length === 0 && (
          <p className="text-muted-foreground text-xs italic px-1">
            Cargando subtareas…
          </p>
        )}

        {!loading && rows.length === 0 && (
          <p className="text-muted-foreground text-sm italic px-1">
            No hay subtareas. Crea la primera con el input de abajo.
          </p>
        )}

        {rows.map((row) => {
          const isDone = row.status === 'DONE'
          const assigneeName = row.assigneeId
            ? userMap.get(row.assigneeId) ?? null
            : null
          return (
            <div
              key={row.id}
              role="listitem"
              className="group flex items-center gap-3 rounded-md border border-border bg-subtle/40 hover:bg-subtle/70 px-3 py-2 transition-colors"
            >
              <input
                type="checkbox"
                checked={isDone}
                onChange={() => handleToggle(row)}
                aria-label={`Marcar ${row.title} como completada`}
                className="h-4 w-4 cursor-pointer rounded border-border bg-input checked:bg-success accent-emerald-500"
              />

              <div className="flex flex-1 items-center gap-2 min-w-0">
                <span
                  className={`truncate text-sm ${
                    isDone
                      ? 'line-through text-muted-foreground'
                      : 'text-foreground'
                  }`}
                  title={row.title}
                >
                  {row.title}
                </span>
                {row.mnemonic && (
                  <span className="text-[10px] text-muted-foreground/80 font-mono shrink-0">
                    {row.mnemonic}
                  </span>
                )}
              </div>

              {/* Asignado: mini-selector */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  data-assignee-trigger
                  onClick={() =>
                    setOpenAssigneeFor((cur) => (cur === row.id ? null : row.id))
                  }
                  aria-label={`Cambiar responsable de ${row.title}`}
                  aria-haspopup="listbox"
                  aria-expanded={openAssigneeFor === row.id}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-secondary text-[10px] font-bold uppercase text-foreground hover:bg-secondary/70 transition-colors"
                  title={assigneeName ?? 'Sin asignar'}
                >
                  {assigneeName ? (
                    initials(assigneeName)
                  ) : (
                    <UserCircle2 className="h-4 w-4 opacity-60" aria-hidden />
                  )}
                </button>

                {openAssigneeFor === row.id && (
                  <div
                    data-assignee-popover
                    role="listbox"
                    className="absolute right-0 top-9 z-20 w-48 max-h-64 overflow-auto rounded-md border border-border bg-card shadow-lg p-1"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={!row.assigneeId}
                      onClick={() => handleAssign(row, null)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary"
                    >
                      <UserCircle2 className="h-3.5 w-3.5" /> Sin asignar
                    </button>
                    {users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        role="option"
                        aria-selected={row.assigneeId === u.id}
                        onClick={() => handleAssign(row, u.id)}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-secondary ${
                          row.assigneeId === u.id
                            ? 'text-foreground font-semibold'
                            : 'text-muted-foreground'
                        }`}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-bold border border-border">
                          {initials(u.name)}
                        </span>
                        <span className="truncate">{u.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Fila fantasma "Añadir subtarea" */}
      <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-subtle/20 px-3 py-2">
        <Plus className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        <label htmlFor={inputId} className="sr-only">
          Añadir subtarea
        </label>
        <input
          id={inputId}
          ref={newInputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleDraftKey}
          placeholder="Añadir subtarea... (presiona Enter para crear)"
          disabled={isPending}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-60"
        />
        {isPending && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            guardando…
          </span>
        )}
      </div>

      {/* Barra de progreso derivada */}
      <div
        className="space-y-1.5 pt-2"
        aria-label="Progreso de subtareas"
        role="group"
      >
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Progreso de subtareas</span>
          <span>
            {done} / {total}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={`h-full transition-all duration-300 ${barColor}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </section>
  )
}
