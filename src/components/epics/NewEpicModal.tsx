'use client'

/**
 * Wave P9 · Agile Maturity — Modal "Nueva Epic" / "Editar Epic".
 *
 * @UIUX spec:
 *   - Layout centered, max-w 480px, body scroll-lock.
 *   - Campos: name (req), description (opt), color (paleta cerrada),
 *     status (radio chips), owner (select users), fechas (opt).
 *   - Acciones: Cancelar (esc) / Guardar.
 *   - Patrón de error: errores tipados del server con toast.
 *
 * Reutilizable para create + edit. En modo edit pasar `initial`.
 */

import { useEffect, useId, useState, useTransition } from 'react'
import { X as CloseIcon } from 'lucide-react'
import { clsx } from 'clsx'
import { createEpic, updateEpic } from '@/lib/actions/epics'
import {
  EPIC_COLOR_PALETTE,
  DEFAULT_EPIC_COLOR,
  isValidEpicColor,
} from '@/lib/epics/colors'
import { toast } from '@/components/interactions/Toaster'

export type EpicModalInitial = {
  id?: string
  name?: string
  description?: string | null
  color?: string
  status?: 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'
  ownerId?: string | null
  plannedStartDate?: string | null
  plannedEndDate?: string | null
}

export type EpicReleaseOption = {
  id: string
  name: string
  version: string
  scopeMode: 'EPIC' | 'SPRINT'
}

type Props = {
  open: boolean
  onClose: () => void
  projectId: string
  users?: { id: string; name: string }[]
  /**
   * Releases del proyecto. Si hay con scopeMode=EPIC, ofrecemos
   * selector para asociar la Epic (regla ágil: Épicas se asignan a
   * un Release según importancia).
   */
  releases?: EpicReleaseOption[]
  defaultReleaseId?: string | null
  /** Si se pasa con `id`, es edit; sin id, es create. */
  initial?: EpicModalInitial
  onSuccess?: (epicId: string) => void
}

const STATUS_OPTIONS = [
  { value: 'PLANNED', label: 'Planeada' },
  { value: 'IN_PROGRESS', label: 'En curso' },
  { value: 'DONE', label: 'Completada' },
  { value: 'CANCELLED', label: 'Cancelada' },
] as const

export function NewEpicModal({
  open,
  onClose,
  projectId,
  users = [],
  releases = [],
  defaultReleaseId,
  initial,
  onSuccess,
}: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [color, setColor] = useState(initial?.color ?? DEFAULT_EPIC_COLOR)
  const [status, setStatus] = useState<EpicModalInitial['status']>(
    initial?.status ?? 'PLANNED',
  )
  const [ownerId, setOwnerId] = useState(initial?.ownerId ?? '')
  const [plannedStartDate, setPlannedStartDate] = useState(
    initial?.plannedStartDate ? initial.plannedStartDate.split('T')[0] : '',
  )
  const [plannedEndDate, setPlannedEndDate] = useState(
    initial?.plannedEndDate ? initial.plannedEndDate.split('T')[0] : '',
  )
  const [releaseId, setReleaseId] = useState(defaultReleaseId ?? '')
  const [isPending, startTransition] = useTransition()

  // Solo Releases con scopeMode=EPIC pueden recibir epics.
  const epicReleases = releases.filter((r) => r.scopeMode === 'EPIC')

  const isEdit = !!initial?.id
  const titleId = useId()

  // Bloquear scroll del body cuando el modal está abierto.
  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [open])

  // Cerrar con Esc.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error('El nombre es requerido')
      return
    }
    if (!isValidEpicColor(color)) {
      toast.error('Color inválido')
      return
    }

    startTransition(async () => {
      try {
        if (isEdit && initial?.id) {
          await updateEpic({
            id: initial.id,
            name: name.trim(),
            description: description || null,
            color,
            status,
            ownerId: ownerId || null,
            plannedStartDate: plannedStartDate || null,
            plannedEndDate: plannedEndDate || null,
          })
          toast.success('Epic actualizada')
          onSuccess?.(initial.id)
        } else {
          const epic = await createEpic({
            name: name.trim(),
            description: description || null,
            color,
            projectId,
            ownerId: ownerId || null,
            plannedStartDate: plannedStartDate || null,
            plannedEndDate: plannedEndDate || null,
            releaseId: releaseId || null,
          })
          toast.success('Epic creada')
          onSuccess?.(epic.id)
        }
        onClose()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al guardar'
        toast.error(msg)
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        // Click en el backdrop cierra; click dentro del card no.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-[480px] rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {isEdit ? 'Editar Epic' : 'Nueva Epic'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          {/* Nombre */}
          <div className="space-y-1.5">
            <label htmlFor="epic-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Nombre <span className="text-destructive">*</span>
            </label>
            <input
              id="epic-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Migración a Cloud"
              autoFocus
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Descripción */}
          <div className="space-y-1.5">
            <label htmlFor="epic-desc" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Descripción
            </label>
            <textarea
              id="epic-desc"
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Breve resumen del alcance y objetivos de esta iniciativa."
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Color */}
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Color
            </legend>
            <div className="flex flex-wrap gap-2">
              {EPIC_COLOR_PALETTE.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setColor(c.hex)}
                  aria-label={`Color: ${c.label}${c.hint ? `, ${c.hint}` : ''}`}
                  aria-pressed={color === c.hex}
                  title={c.hint ?? c.label}
                  className={clsx(
                    'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card',
                    color === c.hex
                      ? 'border-foreground scale-110'
                      : 'border-transparent',
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </fieldset>

          {/* Status (solo edit) + Owner (siempre) */}
          <div className="grid grid-cols-2 gap-3">
            {isEdit && (
              <div className="space-y-1.5">
                <label htmlFor="epic-status" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Estado
                </label>
                <select
                  id="epic-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as EpicModalInitial['status'])}
                  className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className={clsx('space-y-1.5', !isEdit && 'col-span-2')}>
              <label htmlFor="epic-owner" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Owner
              </label>
              <select
                id="epic-owner"
                value={ownerId ?? ''}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Sin owner</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Fechas opcionales */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="epic-start" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Inicio (opcional)
              </label>
              <input
                id="epic-start"
                type="date"
                value={plannedStartDate}
                onChange={(e) => setPlannedStartDate(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="epic-end" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fin (opcional)
              </label>
              <input
                id="epic-end"
                type="date"
                value={plannedEndDate}
                onChange={(e) => setPlannedEndDate(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Selector Release · regla ágil "Épicas se asignan a un Release" */}
          {!isEdit && epicReleases.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="epic-release" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Asociar a Release
              </label>
              <select
                id="epic-release"
                value={releaseId}
                onChange={(e) => setReleaseId(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— Sin Release (no recomendado) —</option>
                {epicReleases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.version})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                ✨ Definición ágil: las Épicas se asignan a un Release según
                qué tan importantes sean. La asociación es opcional pero
                recomendada para trazabilidad.
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary/80 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear Epic'}
          </button>
        </footer>
      </div>
    </div>
  )
}
