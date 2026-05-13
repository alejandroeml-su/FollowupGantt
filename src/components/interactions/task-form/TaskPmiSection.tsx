'use client'

/**
 * Fase 1.5 (2026-05-13) · PMI Task Attributes UI.
 *
 * Captura los campos PMI/PMBOK que NO existen como columnas en Task
 * (las que SÍ — fechas, plannedValue, actualCost, isMilestone, dependencias —
 * tienen su propia UI en otras secciones / sidebar).
 *
 * Campos:
 *   - wbsCode (EDT)
 *   - phaseName (paquete de trabajo, texto libre — el Phase FK ya existe)
 *   - deliverable
 *   - qualityCriteria
 *   - scheduleConstraint (ASAP/ALAP/MSO/...)
 *   - raci (R/A/C/I)
 *   - assumptions
 *   - durationOptimistic / durationPessimistic (PERT)
 */

import { useState, useTransition } from 'react'
import { clsx } from 'clsx'
import { Briefcase, Users, Calendar } from 'lucide-react'
import {
  type PmiAttributes,
  type PmiScheduleConstraint,
  type PmiRaci,
  emptyPmiAttributes,
} from '@/lib/pmi/types'

type Props = {
  mode: 'create' | 'edit'
  value: PmiAttributes | null
  onChange?: (next: PmiAttributes) => void
  onAutosave?: (next: PmiAttributes) => void
  disabled?: boolean
  className?: string
  /** Fase 2 (2026-05-13) — Lista de usuarios para los selectores RACI.
   *  Si no se provee, los campos RACI degradan a texto libre CSV (back-compat). */
  users?: { id: string; name: string }[]
}

const CONSTRAINTS: { id: PmiScheduleConstraint; label: string }[] = [
  { id: 'ASAP', label: 'ASAP — Lo antes posible (default)' },
  { id: 'ALAP', label: 'ALAP — Lo más tarde posible' },
  { id: 'MSO', label: 'MSO — Debe iniciar en…' },
  { id: 'MFO', label: 'MFO — Debe terminar en…' },
  { id: 'SNET', label: 'SNET — No iniciar antes de…' },
  { id: 'SNLT', label: 'SNLT — No iniciar después de…' },
  { id: 'FNET', label: 'FNET — No terminar antes de…' },
  { id: 'FNLT', label: 'FNLT — No terminar después de…' },
]

const FIELD_LABEL =
  'text-xs font-semibold uppercase tracking-wider text-foreground'
const INPUT_BASE =
  'w-full rounded-md border border-border bg-input py-1.5 px-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring'
const TEXTAREA_BASE = clsx(INPUT_BASE, 'resize-none min-h-[60px]')

export function TaskPmiSection({
  mode,
  value,
  onChange,
  onAutosave,
  disabled = false,
  className,
  users = [],
}: Props) {
  const [draft, setDraft] = useState<PmiAttributes>(
    value ?? emptyPmiAttributes(),
  )
  const [, startTransition] = useTransition()

  function patch<K extends keyof PmiAttributes>(
    key: K,
    next: PmiAttributes[K],
  ) {
    const updated = { ...draft, [key]: next }
    setDraft(updated)
    onChange?.(updated)
  }

  function patchRaci(next: PmiRaci | null) {
    const updated = { ...draft, raci: next }
    setDraft(updated)
    onChange?.(updated)
  }

  function commitAutosave() {
    if (mode !== 'edit' || !onAutosave) return
    startTransition(() => onAutosave(draft))
  }

  const raci = draft.raci ?? {}

  return (
    <section
      className={clsx('space-y-4 pt-4', className)}
      aria-label="Atributos PMI"
      data-testid="task-pmi-section"
    >
      <header className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Briefcase className="h-4 w-4" /> Atributos PMI / PMBOK
        </h3>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="pmi-wbs-code" className={FIELD_LABEL}>
            EDT (WBS) <span className="text-muted-foreground text-[10px]">(ej. 1.2.3)</span>
          </label>
          <input
            id="pmi-wbs-code"
            type="text"
            pattern="^\d+(\.\d+)*$"
            value={draft.wbsCode ?? ''}
            onChange={(e) => patch('wbsCode', e.target.value || null)}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
            placeholder="1.2.3"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pmi-phase-name" className={FIELD_LABEL}>
            Paquete de trabajo / Fase
          </label>
          <input
            id="pmi-phase-name"
            type="text"
            value={draft.phaseName ?? ''}
            onChange={(e) => patch('phaseName', e.target.value || null)}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
            placeholder="Ej: Planificación, Ejecución…"
          />
        </div>
      </div>

      {/* Deliverable + Quality criteria */}
      <div className="space-y-1.5">
        <label htmlFor="pmi-deliverable" className={FIELD_LABEL}>
          Entregable <span className="text-destructive">*</span>
        </label>
        <textarea
          id="pmi-deliverable"
          value={draft.deliverable ?? ''}
          onChange={(e) => patch('deliverable', e.target.value || null)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={TEXTAREA_BASE}
          placeholder="Producto, servicio o resultado que esta tarea produce."
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="pmi-quality-criteria" className={FIELD_LABEL}>
          Criterios de calidad <span className="text-destructive">*</span>
        </label>
        <textarea
          id="pmi-quality-criteria"
          value={draft.qualityCriteria ?? ''}
          onChange={(e) => patch('qualityCriteria', e.target.value || null)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={TEXTAREA_BASE}
          placeholder="Cómo se medirá la aceptación del entregable."
        />
      </div>

      {/* Schedule constraint */}
      <div className="space-y-1.5">
        <label htmlFor="pmi-schedule-constraint" className={FIELD_LABEL}>
          <Calendar className="h-3 w-3 inline mr-1" />
          Restricción de calendario
        </label>
        <select
          id="pmi-schedule-constraint"
          value={draft.scheduleConstraint ?? ''}
          onChange={(e) =>
            patch(
              'scheduleConstraint',
              (e.target.value as PmiScheduleConstraint) || null,
            )
          }
          onBlur={commitAutosave}
          disabled={disabled}
          className={INPUT_BASE}
        >
          <option value="">Sin restricción</option>
          {CONSTRAINTS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* RACI — Fase 2 (2026-05-13 · Edwin): user pickers reales en lugar
          de texto libre CSV. R/C/I = multi-select; A = single-select.
          Si `users` viene vacío, degradamos a empty state (sin texto libre
          legado para no permitir tipear IDs inválidos). */}
      <RaciMatrix
        raci={raci}
        users={users}
        onChange={patchRaci}
        onAutosave={commitAutosave}
        disabled={disabled}
      />

      {/* PERT durations */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="pmi-duration-opt" className={FIELD_LABEL}>
            Duración optimista (días)
          </label>
          <input
            id="pmi-duration-opt"
            type="number"
            min={0}
            step={0.5}
            value={draft.durationOptimistic ?? ''}
            onChange={(e) =>
              patch(
                'durationOptimistic',
                e.target.value ? Number(e.target.value) : null,
              )
            }
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pmi-duration-pes" className={FIELD_LABEL}>
            Duración pesimista (días)
          </label>
          <input
            id="pmi-duration-pes"
            type="number"
            min={0}
            step={0.5}
            value={draft.durationPessimistic ?? ''}
            onChange={(e) =>
              patch(
                'durationPessimistic',
                e.target.value ? Number(e.target.value) : null,
              )
            }
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="pmi-assumptions" className={FIELD_LABEL}>
          Supuestos
        </label>
        <textarea
          id="pmi-assumptions"
          value={draft.assumptions ?? ''}
          onChange={(e) => patch('assumptions', e.target.value || null)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={TEXTAREA_BASE}
          placeholder="Supuestos que afectan la planificación."
        />
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// RACI Matrix — subcomponente con user pickers (Fase 2).
// ─────────────────────────────────────────────────────────────────────

function RaciMatrix({
  raci,
  users,
  onChange,
  onAutosave,
  disabled,
}: {
  raci: PmiRaci
  users: { id: string; name: string }[]
  onChange: (next: PmiRaci) => void
  onAutosave: () => void
  disabled: boolean
}) {
  const accountableId = raci.accountable ?? ''

  const setMulti = (key: 'responsible' | 'consulted' | 'informed', ids: string[]) => {
    onChange({ ...raci, [key]: ids })
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-subtle/40 p-3">
      <h4 className={clsx(FIELD_LABEL, 'flex items-center gap-1')}>
        <Users className="h-3 w-3" /> Matriz RACI
      </h4>

      {users.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No hay usuarios disponibles para asignar. Verifica que existan
          miembros activos en el workspace.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* R — multi */}
          <div className="space-y-1.5">
            <label htmlFor="pmi-raci-r" className={FIELD_LABEL}>
              R · Responsable(s)
            </label>
            <RaciMultiSelect
              id="pmi-raci-r"
              users={users}
              selected={raci.responsible ?? []}
              onChange={(ids) => setMulti('responsible', ids)}
              onAutosave={onAutosave}
              disabled={disabled}
            />
          </div>

          {/* A — single */}
          <div className="space-y-1.5">
            <label htmlFor="pmi-raci-a" className={FIELD_LABEL}>
              A · Accountable <span className="text-destructive">*</span>
              <span className="text-muted-foreground text-[10px] ml-1">(uno)</span>
            </label>
            <select
              id="pmi-raci-a"
              value={accountableId}
              onChange={(e) => {
                onChange({ ...raci, accountable: e.target.value || undefined })
              }}
              onBlur={onAutosave}
              disabled={disabled}
              className={INPUT_BASE}
            >
              <option value="">Sin asignar…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          {/* C — multi */}
          <div className="space-y-1.5">
            <label htmlFor="pmi-raci-c" className={FIELD_LABEL}>
              C · Consultado(s)
            </label>
            <RaciMultiSelect
              id="pmi-raci-c"
              users={users}
              selected={raci.consulted ?? []}
              onChange={(ids) => setMulti('consulted', ids)}
              onAutosave={onAutosave}
              disabled={disabled}
            />
          </div>

          {/* I — multi */}
          <div className="space-y-1.5">
            <label htmlFor="pmi-raci-i" className={FIELD_LABEL}>
              I · Informado(s)
            </label>
            <RaciMultiSelect
              id="pmi-raci-i"
              users={users}
              selected={raci.informed ?? []}
              onChange={(ids) => setMulti('informed', ids)}
              onAutosave={onAutosave}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Multi-select de usuarios estilo chip + dropdown nativo. Render: lista
 * de chips de los seleccionados + un `<select>` que añade al hacer change.
 * Cada chip tiene botón `×` para remover. Patrón ligero sin lib extra.
 */
function RaciMultiSelect({
  id,
  users,
  selected,
  onChange,
  onAutosave,
  disabled,
}: {
  id: string
  users: { id: string; name: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
  onAutosave: () => void
  disabled: boolean
}) {
  const available = users.filter((u) => !selected.includes(u.id))

  const add = (uid: string) => {
    if (!uid || selected.includes(uid)) return
    onChange([...selected, uid])
    // autosave on next tick para que el state ya tenga el cambio
    setTimeout(onAutosave, 0)
  }
  const remove = (uid: string) => {
    onChange(selected.filter((x) => x !== uid))
    setTimeout(onAutosave, 0)
  }

  return (
    <div className="space-y-1.5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((uid) => {
            const u = users.find((x) => x.id === uid)
            return (
              <span
                key={uid}
                className="inline-flex items-center gap-1 rounded bg-indigo-500/20 border border-indigo-500/40 px-2 py-0.5 text-[11px] text-indigo-200"
              >
                {u?.name ?? uid}
                <button
                  type="button"
                  onClick={() => remove(uid)}
                  disabled={disabled}
                  aria-label={`Quitar ${u?.name ?? uid}`}
                  className="hover:text-rose-300 disabled:opacity-50"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
      <select
        id={id}
        value=""
        onChange={(e) => add(e.target.value)}
        disabled={disabled || available.length === 0}
        className={INPUT_BASE}
      >
        <option value="">
          {available.length === 0
            ? '(todos asignados)'
            : selected.length === 0
              ? 'Selecciona usuario…'
              : '+ Añadir otro…'}
        </option>
        {available.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </div>
  )
}
