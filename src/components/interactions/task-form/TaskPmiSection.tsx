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

      {/* RACI */}
      <div className="space-y-2 rounded-md border border-border bg-subtle/40 p-3">
        <h4 className={clsx(FIELD_LABEL, 'flex items-center gap-1')}>
          <Users className="h-3 w-3" /> Matriz RACI
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="pmi-raci-responsible" className={FIELD_LABEL}>
              R · Responsable(s) <span className="text-muted-foreground text-[10px]">(CSV)</span>
            </label>
            <input
              id="pmi-raci-responsible"
              type="text"
              value={(raci.responsible ?? []).join(', ')}
              onChange={(e) =>
                patchRaci({
                  ...raci,
                  responsible: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              onBlur={commitAutosave}
              disabled={disabled}
              className={INPUT_BASE}
              placeholder="user_a, user_b"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pmi-raci-accountable" className={FIELD_LABEL}>
              A · Accountable <span className="text-destructive">*</span>
              <span className="text-muted-foreground text-[10px] ml-1">(uno)</span>
            </label>
            <input
              id="pmi-raci-accountable"
              type="text"
              value={raci.accountable ?? ''}
              onChange={(e) =>
                patchRaci({ ...raci, accountable: e.target.value || undefined })
              }
              onBlur={commitAutosave}
              disabled={disabled}
              className={INPUT_BASE}
              placeholder="user_c"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pmi-raci-consulted" className={FIELD_LABEL}>
              C · Consultado(s)
            </label>
            <input
              id="pmi-raci-consulted"
              type="text"
              value={(raci.consulted ?? []).join(', ')}
              onChange={(e) =>
                patchRaci({
                  ...raci,
                  consulted: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              onBlur={commitAutosave}
              disabled={disabled}
              className={INPUT_BASE}
              placeholder="user_d, user_e"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pmi-raci-informed" className={FIELD_LABEL}>
              I · Informado(s)
            </label>
            <input
              id="pmi-raci-informed"
              type="text"
              value={(raci.informed ?? []).join(', ')}
              onChange={(e) =>
                patchRaci({
                  ...raci,
                  informed: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              onBlur={commitAutosave}
              disabled={disabled}
              className={INPUT_BASE}
              placeholder="user_f"
            />
          </div>
        </div>
      </div>

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
