'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Plus, X as CloseIcon, Star, CalendarDays } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from './Toaster'
import { quickCreateTaskForDate } from '@/lib/actions/calendar'

type ProjectRef = { id: string; name: string }
type UserRef = { id: string; name: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fecha ISO YYYY-MM-DD que originó la apertura */
  date: string | null
  projects: ProjectRef[]
  users: UserRef[]
  /** Proyecto preseleccionado (desde el filtro activo) */
  defaultProjectId?: string | null
  /** Contexto de auth para el RBAC del server action. */
  currentUserId?: string | null
  currentUserRoles?: string[]
  onCreated?: (taskId: string) => void
}

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Baja', cls: 'hover:border-border' },
  { value: 'MEDIUM', label: 'Media', cls: 'hover:border-blue-500' },
  { value: 'HIGH', label: 'Alta', cls: 'hover:border-amber-500' },
  { value: 'CRITICAL', label: 'Crítica', cls: 'hover:border-red-500' },
]

const PRIORITY_ACTIVE: Record<string, string> = {
  LOW: 'border-border bg-secondary text-foreground',
  MEDIUM: 'border-blue-500 bg-blue-500/15 text-blue-300',
  HIGH: 'border-amber-500 bg-amber-500/15 text-amber-300',
  CRITICAL: 'border-red-500 bg-red-500/15 text-red-300',
}

export function QuickCreatePopover({
  open,
  onOpenChange,
  date,
  projects,
  users,
  defaultProjectId,
  currentUserId,
  currentUserRoles = [],
  onCreated,
}: Props) {
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>(
    'MEDIUM',
  )
  const [assigneeId, setAssigneeId] = useState('')
  const [isMilestone, setIsMilestone] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setTitle('')
      setPriority('MEDIUM')
      setAssigneeId('')
      setIsMilestone(false)
      setProjectId(defaultProjectId ?? '')
    }
  }, [open, defaultProjectId])

  function submit() {
    const t = title.trim()
    if (!t || !projectId || !date) return
    startTransition(async () => {
      try {
        const res = await quickCreateTaskForDate({
          title: t,
          projectId,
          date,
          priority,
          isMilestone,
          assigneeId: assigneeId || null,
          userId: currentUserId ?? null,
          userRoles: currentUserRoles,
        })
        toast.success(`Creada ${res.mnemonic}: "${t}"`)
        onCreated?.(res.id)
        onOpenChange(false)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
        toast.error(m ? `${m[1]} · ${m[2]}` : msg)
      }
    })
  }

  const dateLabel = date
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
    : ''

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl"
        >
          <div className="mb-4 flex items-start justify-between">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CalendarDays className="h-4 w-4 text-indigo-400" />
                Nueva actividad
              </Dialog.Title>
              <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                {dateLabel || 'Selecciona una fecha'}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Cerrar"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="qc-title"
                className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Título
              </label>
              <input
                ref={inputRef}
                id="qc-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                  }
                }}
                placeholder="Ej. Revisar cronograma semanal"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="qc-project"
                  className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Proyecto
                </label>
                <select
                  id="qc-project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <option value="">— Seleccionar —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="qc-assignee"
                  className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Responsable
                </label>
                <select
                  id="qc-assignee"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <option value="">Sin asignar</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Prioridad
              </span>
              <div role="radiogroup" aria-label="Prioridad" className="flex gap-1.5">
                {PRIORITY_OPTIONS.map((p) => {
                  const active = priority === p.value
                  return (
                    <button
                      key={p.value}
                      role="radio"
                      aria-checked={active}
                      type="button"
                      onClick={() =>
                        setPriority(p.value as typeof priority)
                      }
                      className={clsx(
                        'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                        active
                          ? PRIORITY_ACTIVE[p.value]
                          : `border-border bg-background text-muted-foreground ${p.cls}`,
                      )}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={isMilestone}
                onChange={(e) => setIsMilestone(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-amber-500"
              />
              <Star
                className={clsx(
                  'h-3.5 w-3.5',
                  isMilestone ? 'text-amber-400' : 'text-muted-foreground',
                )}
              />
              Es un hito (milestone)
            </label>
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">
              <kbd className="rounded bg-muted px-1 font-mono">Enter</kbd> para
              crear ·{' '}
              <kbd className="rounded bg-muted px-1 font-mono">Esc</kbd> para
              cerrar
            </p>
            <div className="flex items-center gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                >
                  Cancelar
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={submit}
                disabled={!title.trim() || !projectId || isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {isPending ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
