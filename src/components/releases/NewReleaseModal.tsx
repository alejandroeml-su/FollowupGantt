'use client'

/**
 * Wave P9 · Agile Maturity (HU-9.4) — Modal "Nueva Release" / "Editar".
 *
 * Decisión @UIUX:
 *   - Wizard de 1 paso (no multi-step) para no agregar fricción.
 *   - scopeMode con radios visuales (Epic vs Sprint) — exclusivo, no se
 *     puede cambiar en edit (cambiar scope post-creación es ambiguo;
 *     mejor archivar y crear nueva).
 *   - Multi-select via checkboxes (más accesible que combobox custom).
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import { X as CloseIcon, Sparkles, Rocket, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import {
  createRelease,
  updateRelease,
  setReleaseEpics,
  setReleaseSprints,
} from '@/lib/actions/releases'
import { NewSprintModal } from '@/components/sprints/NewSprintModal'
import { toast } from '@/components/interactions/Toaster'

type EpicOption = {
  id: string
  name: string
  color: string
}
type SprintOption = {
  id: string
  name: string
  startDate: string | null
  endDate: string | null
}

export type ReleaseModalInitial = {
  id?: string
  name?: string
  version?: string
  description?: string | null
  scopeMode?: 'EPIC' | 'SPRINT'
  plannedDate?: string
  ownerId?: string | null
  selectedEpicIds?: string[]
  selectedSprintIds?: string[]
}

type Props = {
  open: boolean
  onClose: () => void
  projectId: string
  /** Wave P14b — nombre del proyecto · visible en el header del modal para
   *  dejar claro a qué proyecto se ancla la release. */
  projectName?: string
  users?: { id: string; name: string }[]
  epics?: EpicOption[]
  sprints?: SprintOption[]
  initial?: ReleaseModalInitial
  onSuccess?: (releaseId: string) => void
}

export function NewReleaseModal({
  open,
  onClose,
  projectId,
  projectName,
  users = [],
  epics = [],
  sprints = [],
  initial,
  onSuccess,
}: Props) {
  const isEdit = !!initial?.id
  const [name, setName] = useState(initial?.name ?? '')
  const [version, setVersion] = useState(initial?.version ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [scopeMode, setScopeMode] = useState<'EPIC' | 'SPRINT'>(initial?.scopeMode ?? 'EPIC')
  const [plannedDate, setPlannedDate] = useState(
    initial?.plannedDate ? initial.plannedDate.split('T')[0] : '',
  )
  const [ownerId, setOwnerId] = useState(initial?.ownerId ?? '')
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<string>>(
    new Set(initial?.selectedEpicIds ?? []),
  )
  const [selectedSprintIds, setSelectedSprintIds] = useState<Set<string>>(
    new Set(initial?.selectedSprintIds ?? []),
  )
  const [isPending, startTransition] = useTransition()

  // Wave P9 follow-up demo — sprints recién creados desde este modal,
  // se mantienen locales hasta el siguiente refresh del padre.
  const [extraSprints, setExtraSprints] = useState<SprintOption[]>([])
  const [showSprintModal, setShowSprintModal] = useState(false)
  const allSprints = useMemo(
    () => [...sprints, ...extraSprints],
    [sprints, extraSprints],
  )

  useEffect(() => {
    if (!open) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = orig
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const toggleEpic = (id: string) => {
    setSelectedEpicIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSprint = (id: string) => {
    setSelectedSprintIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = () => {
    if (!name.trim()) return toast.error('Nombre requerido')
    if (!version.trim()) return toast.error('Versión requerida (ej. v1.0)')
    if (!plannedDate) return toast.error('Fecha planeada requerida')

    startTransition(async () => {
      try {
        let releaseId: string
        if (isEdit && initial?.id) {
          await updateRelease({
            id: initial.id,
            name: name.trim(),
            version: version.trim(),
            description: description || null,
            plannedDate,
            ownerId: ownerId || null,
          })
          releaseId = initial.id
        } else {
          const r = await createRelease({
            name: name.trim(),
            version: version.trim(),
            description: description || null,
            scopeMode,
            plannedDate,
            ownerId: ownerId || null,
            projectId,
          })
          releaseId = r.id
        }

        // Persistir scope (epics o sprints según modo).
        if (scopeMode === 'EPIC') {
          await setReleaseEpics({
            releaseId,
            epicIds: Array.from(selectedEpicIds),
          })
        } else {
          await setReleaseSprints({
            releaseId,
            sprintIds: Array.from(selectedSprintIds),
          })
        }

        toast.success(isEdit ? 'Release actualizada' : 'Release creada')
        onSuccess?.(releaseId)
        onClose()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
        <header className="sticky top-0 flex items-start justify-between border-b border-border bg-card px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {isEdit ? 'Editar Release' : 'Nueva Release'}
            </h2>
            {/* Wave P14b — proyecto visible para dejar clara la dependencia */}
            {projectName && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Proyecto:{' '}
                <span className="font-medium text-indigo-300">
                  {projectName}
                </span>
              </p>
            )}
          </div>
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
          {/* Datos básicos */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Nombre <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Lanzamiento Q3"
                autoFocus
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Versión <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v1.0"
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Descripción
            </label>
            <textarea
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Lo que se entrega en esta release."
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fecha planeada <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Owner
              </label>
              <select
                value={ownerId ?? ''}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Sin owner</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scope mode (solo en create) */}
          {!isEdit && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tipo de scope
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <ScopeRadio
                  value="EPIC"
                  current={scopeMode}
                  onSelect={() => setScopeMode('EPIC')}
                  icon={<Sparkles className="h-4 w-4" />}
                  label="Por Epics"
                  hint="Agrupa N iniciativas"
                />
                <ScopeRadio
                  value="SPRINT"
                  current={scopeMode}
                  onSelect={() => setScopeMode('SPRINT')}
                  icon={<Rocket className="h-4 w-4" />}
                  label="Por Sprints"
                  hint="Agrupa N iteraciones"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Una vez creada, el tipo no se puede cambiar.
              </p>
            </fieldset>
          )}

          {/* Selector de items según modo */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {scopeMode === 'EPIC' ? 'Epics incluidas' : 'Sprints incluidos'}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {scopeMode === 'EPIC'
                  ? `${selectedEpicIds.size} de ${epics.length} seleccionadas`
                  : `${selectedSprintIds.size} de ${sprints.length} seleccionados`}
              </span>
            </div>

            <div className="max-h-[200px] space-y-1 overflow-y-auto rounded-md border border-border bg-input p-2">
              {scopeMode === 'EPIC' ? (
                epics.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-[11px] text-muted-foreground">
                      No hay Epics activas en{' '}
                      {projectName ? (
                        <span className="font-medium text-foreground">
                          {projectName}
                        </span>
                      ) : (
                        'este proyecto'
                      )}
                      .
                    </p>
                    <a
                      href="/agile/epics"
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300"
                    >
                      <Plus className="h-3 w-3" />
                      Crear una Epic primero
                    </a>
                  </div>
                ) : (
                  epics.map((e) => (
                    <label
                      key={e.id}
                      className={clsx(
                        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                        selectedEpicIds.has(e.id)
                          ? 'bg-indigo-500/10 text-foreground'
                          : 'hover:bg-secondary',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedEpicIds.has(e.id)}
                        onChange={() => toggleEpic(e.id)}
                        className="h-4 w-4 cursor-pointer accent-indigo-500"
                      />
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: e.color }}
                        aria-hidden
                      />
                      <span className="text-foreground">{e.name}</span>
                    </label>
                  ))
                )
              ) : (
                <>
                  {allSprints.length === 0 ? (
                    <p className="py-3 text-center text-[11px] text-muted-foreground">
                      No hay sprints activos. Crea uno con el botón de abajo.
                    </p>
                  ) : (
                    allSprints.map((s) => (
                      <label
                        key={s.id}
                        className={clsx(
                          'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                          selectedSprintIds.has(s.id)
                            ? 'bg-indigo-500/10 text-foreground'
                            : 'hover:bg-secondary',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSprintIds.has(s.id)}
                          onChange={() => toggleSprint(s.id)}
                          className="h-4 w-4 cursor-pointer accent-indigo-500"
                        />
                        <span className="text-foreground">{s.name}</span>
                        {s.startDate && s.endDate && (
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {new Date(s.startDate).toLocaleDateString()} →{' '}
                            {new Date(s.endDate).toLocaleDateString()}
                          </span>
                        )}
                      </label>
                    ))
                  )}
                  {/* CTA crear sprint inline */}
                  <button
                    type="button"
                    onClick={() => setShowSprintModal(true)}
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-indigo-500/40 bg-indigo-500/5 px-2 py-2 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/15"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Crear nuevo sprint
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3">
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
            disabled={isPending || !name.trim() || !version.trim() || !plannedDate}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? 'Guardando…' : isEdit ? 'Guardar' : 'Crear Release'}
          </button>
        </footer>
      </div>

      {/* Sprint inline creation modal (overlay encima de Release modal) */}
      <NewSprintModal
        open={showSprintModal}
        onClose={() => setShowSprintModal(false)}
        projectId={projectId}
        onSuccess={(newSprintId) => {
          // Agregar a la lista local con datos placeholder y auto-seleccionar.
          // El próximo refresh del padre traerá el detalle completo.
          setExtraSprints((prev) => [
            ...prev,
            {
              id: newSprintId,
              name: 'Sprint recién creado',
              startDate: null,
              endDate: null,
            },
          ])
          setSelectedSprintIds((prev) => new Set([...prev, newSprintId]))
        }}
      />
    </div>
  )
}

function ScopeRadio({
  value,
  current,
  onSelect,
  icon,
  label,
  hint,
}: {
  value: 'EPIC' | 'SPRINT'
  current: 'EPIC' | 'SPRINT'
  onSelect: () => void
  icon: React.ReactNode
  label: string
  hint: string
}) {
  const active = value === current
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        'flex cursor-pointer items-start gap-2 rounded-md border p-3 text-left transition-colors',
        active
          ? 'border-indigo-500 bg-indigo-500/10'
          : 'border-border bg-input hover:border-indigo-500/40',
      )}
    >
      <div
        className={clsx(
          'mt-0.5',
          active ? 'text-indigo-400' : 'text-muted-foreground',
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      </div>
      <input
        type="radio"
        checked={active}
        readOnly
        className="mt-0.5 h-4 w-4 accent-indigo-500"
      />
    </button>
  )
}
