'use client'

/**
 * Wave P9 follow-up (HU-9.5 fix demo) — Modal "Nuevo Sprint" / "Editar Sprint".
 *
 * @UIUX spec:
 *   - Layout centered, max-w 480px, body scroll-lock.
 *   - Header con título + close (X).
 *   - Campos: name (req), goal (textarea opt), startDate, endDate (date inputs),
 *     capacity (number opcional · horas-equipo).
 *   - Auto-calcula duración en días (chip informativo).
 *   - Acciones: Cancelar (esc) / Crear Sprint.
 *   - Errores tipados con toast.
 *
 * Uso:
 *   <NewSprintModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     projectId={projectId}
 *     defaultStart={iso}     // opcional · presetea startDate
 *     onSuccess={(sprintId) => ...}
 *   />
 */

import { useEffect, useId, useMemo, useState, useTransition } from 'react'
import { X as CloseIcon, Rocket, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { createSprintWithCapacity } from '@/lib/actions/sprints'
import { toast } from '@/components/interactions/Toaster'

export type ReleaseOption = {
  id: string
  name: string
  version: string
  scopeMode: 'EPIC' | 'SPRINT'
}

type Props = {
  open: boolean
  onClose: () => void
  projectId: string
  /** Pre-poblado opcional. Si viene, se usa como default startDate. */
  defaultStart?: string | null
  /** Pre-poblado opcional. Default = startDate + 14 días. */
  defaultEnd?: string | null
  /**
   * Releases con scopeMode=SPRINT del proyecto. Si hay alguna, se ofrece
   * selector para asociar el sprint a una release (regla ágil: Sprints
   * viven dentro de un Release).
   */
  releases?: ReleaseOption[]
  /** Pre-selecciona una release (caller que sabe contexto). */
  defaultReleaseId?: string | null
  onSuccess?: (sprintId: string) => void
}

function todayIso(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function diffDays(startIso: string, endIso: string): number | null {
  if (!startIso || !endIso) return null
  const s = new Date(startIso)
  const e = new Date(endIso)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null
  const ms = e.getTime() - s.getTime()
  return Math.round(ms / 86_400_000) + 1
}

export function NewSprintModal({
  open,
  onClose,
  projectId,
  defaultStart,
  defaultEnd,
  releases = [],
  defaultReleaseId,
  onSuccess,
}: Props) {
  const titleId = useId()
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [startDate, setStartDate] = useState(defaultStart ?? todayIso())
  const [endDate, setEndDate] = useState(defaultEnd ?? todayIso(14))
  const [capacity, setCapacity] = useState<string>('')
  const [releaseId, setReleaseId] = useState<string>(defaultReleaseId ?? '')
  const [isPending, startTransition] = useTransition()

  // Solo Releases con scopeMode=SPRINT pueden recibir sprints.
  const sprintReleases = useMemo(
    () => releases.filter((r) => r.scopeMode === 'SPRINT'),
    [releases],
  )

  // Reset al abrir/cerrar. Reset state syncronously when `open` changes
  // (no useEffect → cumple regla react-hooks/set-state-in-effect).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setName('')
      setGoal('')
      setStartDate(defaultStart ?? todayIso())
      setEndDate(defaultEnd ?? todayIso(14))
      setCapacity('')
      setReleaseId(defaultReleaseId ?? '')
    }
  }

  // Body scroll-lock.
  useEffect(() => {
    if (!open) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = orig
    }
  }, [open])

  // Esc para cerrar.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, isPending, onClose])

  const days = useMemo(() => diffDays(startDate, endDate), [startDate, endDate])
  // Regla ágil: Sprint Goal obligatorio + nombre + rango válido.
  const valid =
    name.trim().length > 0 &&
    goal.trim().length > 0 &&
    startDate &&
    endDate &&
    days != null &&
    days > 0

  if (!open) return null

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error('Nombre del sprint requerido')
      return
    }
    if (!goal.trim()) {
      toast.error('Sprint Goal requerido — cada sprint debe tener una meta clara')
      return
    }
    if (!days || days <= 0) {
      toast.error('Fechas inválidas (fin debe ser ≥ inicio)')
      return
    }

    startTransition(async () => {
      try {
        const result = await createSprintWithCapacity({
          name: name.trim(),
          projectId,
          goal: goal.trim(),
          startDate,
          endDate,
          capacity: capacity ? Number(capacity) : null,
          releaseId: releaseId || null,
        })
        toast.success(`Sprint "${name.trim()}" creado`)
        onSuccess?.(result.id)
        onClose()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al crear sprint')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-indigo-400" />
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              Nuevo Sprint
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Cerrar"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Nombre */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Nombre del sprint <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint 1 · Planeación"
              autoFocus
              className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Goal — OBLIGATORIO según definición ágil */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sprint Goal <span className="text-rose-400">*</span>
            </label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Ej. Cerrar onboarding del módulo de inventarios..."
              rows={2}
              className="mt-1 w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              🎯 Cada Sprint debe tener una meta clara que diga para qué se está
              trabajando.
            </p>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Inicio <span className="text-rose-400">*</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fin <span className="text-rose-400">*</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Duración chip */}
          {days != null && days > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
              <div className="text-[11px] text-indigo-300">
                ⏱️ Duración: <span className="font-semibold">{days} día{days === 1 ? '' : 's'}</span>{' '}
                {days <= 7 && '(corto)'}
                {days >= 8 && days <= 14 && '(estándar Scrum)'}
                {days > 14 && days <= 30 && '(largo)'}
                {days > 30 && '(considera split)'}
              </div>
            </div>
          )}

          {/* Capacity */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Capacidad estimada (story points)
            </label>
            <input
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Ej. 30"
              min={0}
              className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Opcional · podrás ajustarlo después en Sprint Planning
            </p>
          </div>

          {/* Selector Release · regla ágil "Sprints viven dentro de un Release" */}
          {sprintReleases.length > 0 && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Asociar a Release
              </label>
              <select
                value={releaseId}
                onChange={(e) => setReleaseId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— Sin Release (no recomendado) —</option>
                {sprintReleases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.version})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                🚀 Definición ágil: los Sprints viven dentro de un Release. La
                asociación es opcional pero recomendada para trazabilidad.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-card/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-border bg-input px-4 py-2 text-sm font-medium text-foreground hover:bg-input/70 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !valid}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold transition-colors',
              valid && !isPending
                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            {isPending ? 'Creando…' : 'Crear Sprint'}
          </button>
        </div>
      </div>
    </div>
  )
}
