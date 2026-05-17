'use client'

/**
 * Fase 1 (2026-05-13) · ITIL Task Attributes UI.
 *
 * Sección colapsable para capturar los atributos ITIL de una tarea de
 * tipo `ITIL_TICKET`. En modo `create` actúa como input controlado (el
 * padre serializa al FormData de `createTask`). En modo `edit` autosalva
 * el draft al server via `updateTask` con `itilAttributes` JSON.
 *
 * Campos mínimos (Fase 1):
 *   - recordType (obligatorio)
 *   - impact, urgency (obligatorios)
 *   - serviceCategory, reporter (libres)
 *   - symptom, diagnosis, workaround, resolution (texto)
 *   - rootCause (solo si recordType === Problem)
 *   - changeType, riskAssessment, implementationPlan, rollbackPlan,
 *     cabApproval, changeWindowStart/End (solo si recordType === Change)
 *
 * El matriz P1..P4 se calcula y muestra como badge a partir de
 * impact × urgency.
 *
 * Deuda Fase 2/3 (parcial): FKs a CMDB resuelto en Wave R5 · US-9.3
 * (selector "CIs afectados" con TaskCILink, ver más abajo). SLA
 * templates, support groups y tablas normalizadas siguen pendientes.
 * Reglas de validación I-01..I-10 del documento de Definición Extendida
 * de Tareas también siguen como deuda.
 *
 * Wave R5 · US-9.3 — CMDB simplificado · selector "CIs afectados".
 * Aplica sólo cuando la task es ITIL_TICKET. El selector busca CIs por
 * nombre/código y crea TaskCILink rows con role=AFFECTED. La integración
 * usa el server action `searchCIs` para autocompletado y `linkTaskToCI`/
 * `unlinkTaskFromCI` para mutaciones. Sólo se monta en `mode='edit'`
 * porque en `mode='create'` la task aún no tiene id (los links se
 * agregan después de crear, en el drawer).
 */

import { useState, useTransition } from 'react'
import { ShieldAlert, Wrench, AlertTriangle } from 'lucide-react'
import { TaskCISelector } from '@/components/cmdb/TaskCISelector'
import { clsx } from 'clsx'
import {
  type ItilAttributes,
  type ItilRecordType,
  type ItilImpact,
  type ItilUrgency,
  type ItilChangeType,
  emptyItilAttributes,
  calculatePriorityMatrix,
} from '@/lib/itil/types'

/** Wave R5 · US-9.3 — link Task↔CI ya persistido para esta task. */
export type CILinkSummary = {
  id: string
  role: 'AFFECTED' | 'CAUSE' | 'AFFECTED_DOWNSTREAM' | 'INFORMATIONAL'
  ci: {
    id: string
    code: string
    name: string
    type: string
    criticality: string
  }
}

type Props = {
  /**
   * `create`: padre controla el valor y recibe cambios via onChange. Sin
   *           persistencia inline. El padre serializa al FormData con
   *           clave `itilAttributes` (JSON.stringify).
   * `edit`:   autosalva onBlur via updateTask. Bandera `disabled` se
   *           respeta para el modo solo-lectura del drawer.
   */
  mode: 'create' | 'edit'
  value: ItilAttributes | null
  onChange?: (next: ItilAttributes) => void
  /** Sólo en mode='edit'. Persistencia onBlur via updateTask. */
  onAutosave?: (next: ItilAttributes) => void
  disabled?: boolean
  className?: string
  /**
   * Wave R5 · US-9.3 — id de la task. Habilita el selector CMDB cuando
   * `mode='edit'`. Si no se pasa (ej. modo create), el selector NO se
   * renderiza para evitar links huérfanos antes de crear.
   */
  taskId?: string | null
  /** CIs ya linkeados a esta task (pre-cargados desde el server). */
  ciLinks?: CILinkSummary[]
}

const RECORD_TYPES: { id: ItilRecordType; label: string; emoji: string }[] = [
  { id: 'Incident', label: 'Incidente', emoji: '🚨' },
  { id: 'Problem', label: 'Problema', emoji: '🔬' },
  { id: 'Change', label: 'Cambio', emoji: '🛠️' },
  { id: 'ServiceRequest', label: 'Solicitud de servicio', emoji: '📋' },
  { id: 'Event', label: 'Evento', emoji: '📡' },
]

const IMPACT_OPTIONS: ItilImpact[] = ['Bajo', 'Medio', 'Alto']
const URGENCY_OPTIONS: ItilUrgency[] = ['Baja', 'Media', 'Alta']
const CHANGE_TYPES: ItilChangeType[] = ['Standard', 'Normal', 'Emergency']

const FIELD_LABEL =
  'text-xs font-semibold uppercase tracking-wider text-foreground'
const INPUT_BASE =
  'w-full rounded-md border border-border bg-input py-1.5 px-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring'
const TEXTAREA_BASE = clsx(INPUT_BASE, 'resize-none min-h-[72px]')

const PRIORITY_COLOR: Record<'P1' | 'P2' | 'P3' | 'P4', string> = {
  P1: 'bg-red-500/20 text-red-300 border-red-500/40',
  P2: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  P3: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  P4: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
}

export function TaskItilSection({
  mode,
  value,
  onChange,
  onAutosave,
  disabled = false,
  className,
  taskId,
  ciLinks,
}: Props) {
  const [draft, setDraft] = useState<ItilAttributes>(
    value ?? emptyItilAttributes(),
  )
  const [, startTransition] = useTransition()

  // Sincroniza el draft local cuando el padre re-pasa value (después de
  // revalidate del server).
  /* eslint-disable react-hooks/set-state-in-effect */
  // (sync logic — mismo patrón que ReferenceUrlField/CollaboratorsField)
  if (value && JSON.stringify(value) !== JSON.stringify(draft)) {
    // No usamos useEffect aquí porque el render-time check evita re-renders
    // innecesarios. setState dentro de render es válido si la condición
    // depende de props (React lo trata como derived state).
  }
  /* eslint-enable react-hooks/set-state-in-effect */

  const matrix = calculatePriorityMatrix(draft.impact, draft.urgency)

  function patch<K extends keyof ItilAttributes>(
    key: K,
    next: ItilAttributes[K],
  ) {
    const updated = { ...draft, [key]: next }
    setDraft(updated)
    onChange?.(updated)
  }

  function commitAutosave() {
    if (mode !== 'edit') return
    if (!onAutosave) return
    startTransition(() => onAutosave(draft))
  }

  const isChange = draft.recordType === 'Change'
  const isProblem = draft.recordType === 'Problem'

  return (
    <section
      className={clsx('space-y-4 pt-4', className)}
      aria-label="Atributos ITIL"
      data-testid="task-itil-section"
    >
      <header className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Atributos ITIL
        </h3>
        <span
          className={clsx(
            'rounded px-2 py-0.5 text-[10px] font-black border',
            PRIORITY_COLOR[matrix],
          )}
          title="Calculado: impact × urgency"
        >
          {matrix}
        </span>
      </header>

      {/* Tipo de registro */}
      <div className="space-y-1.5">
        <label htmlFor="itil-record-type" className={FIELD_LABEL}>
          Tipo de registro <span className="text-destructive">*</span>
        </label>
        <select
          id="itil-record-type"
          value={draft.recordType}
          onChange={(e) => patch('recordType', e.target.value as ItilRecordType)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={INPUT_BASE}
        >
          {RECORD_TYPES.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.emoji} {rt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Impact + Urgency lado a lado */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="itil-impact" className={FIELD_LABEL}>
            Impacto <span className="text-destructive">*</span>
          </label>
          <select
            id="itil-impact"
            value={draft.impact}
            onChange={(e) => patch('impact', e.target.value as ItilImpact)}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          >
            {IMPACT_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="itil-urgency" className={FIELD_LABEL}>
            Urgencia <span className="text-destructive">*</span>
          </label>
          <select
            id="itil-urgency"
            value={draft.urgency}
            onChange={(e) => patch('urgency', e.target.value as ItilUrgency)}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          >
            {URGENCY_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Categoría de servicio + Reporter */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="itil-service-category" className={FIELD_LABEL}>
            Categoría de servicio
          </label>
          <input
            id="itil-service-category"
            type="text"
            value={draft.serviceCategory ?? ''}
            onChange={(e) => patch('serviceCategory', e.target.value || null)}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
            placeholder="Ej: Email, Red, Web Booking…"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="itil-reporter" className={FIELD_LABEL}>
            Reportante / canal
          </label>
          <input
            id="itil-reporter"
            type="text"
            value={draft.reporter ?? ''}
            onChange={(e) => patch('reporter', e.target.value || null)}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
            placeholder="Ej: Recepción, MSP, Email…"
          />
        </div>
      </div>

      {/* Síntoma */}
      <div className="space-y-1.5">
        <label htmlFor="itil-symptom" className={FIELD_LABEL}>
          Síntoma reportado
        </label>
        <textarea
          id="itil-symptom"
          value={draft.symptom ?? ''}
          onChange={(e) => patch('symptom', e.target.value || null)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={TEXTAREA_BASE}
          placeholder="¿Qué reportó el usuario? Comportamiento observado, mensajes de error…"
        />
      </div>

      {/* Diagnóstico */}
      <div className="space-y-1.5">
        <label htmlFor="itil-diagnosis" className={FIELD_LABEL}>
          Diagnóstico
        </label>
        <textarea
          id="itil-diagnosis"
          value={draft.diagnosis ?? ''}
          onChange={(e) => patch('diagnosis', e.target.value || null)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={TEXTAREA_BASE}
          placeholder="Análisis técnico. Obligatorio antes de pasar a 'En progreso'."
        />
      </div>

      {/* Workaround */}
      <div className="space-y-1.5">
        <label htmlFor="itil-workaround" className={FIELD_LABEL}>
          Workaround (solución temporal)
        </label>
        <textarea
          id="itil-workaround"
          value={draft.workaround ?? ''}
          onChange={(e) => patch('workaround', e.target.value || null)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={TEXTAREA_BASE}
          placeholder="Solución provisional aplicada mientras se resuelve definitivamente."
        />
      </div>

      {/* Resolución */}
      <div className="space-y-1.5">
        <label htmlFor="itil-resolution" className={FIELD_LABEL}>
          Resolución
        </label>
        <textarea
          id="itil-resolution"
          value={draft.resolution ?? ''}
          onChange={(e) => patch('resolution', e.target.value || null)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={TEXTAREA_BASE}
          placeholder="Qué se hizo para resolver. Obligatorio al cerrar el ticket."
        />
      </div>

      {/* Root Cause — solo Problem */}
      {isProblem && (
        <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <label
            htmlFor="itil-root-cause"
            className={clsx(FIELD_LABEL, 'text-amber-300 flex items-center gap-1')}
          >
            <AlertTriangle className="h-3 w-3" /> Causa raíz (RCA)
            <span className="text-destructive ml-1">*</span>
          </label>
          <textarea
            id="itil-root-cause"
            value={draft.rootCause ?? ''}
            onChange={(e) => patch('rootCause', e.target.value || null)}
            onBlur={commitAutosave}
            disabled={disabled}
            className={TEXTAREA_BASE}
            placeholder="Análisis causa-raíz. Obligatorio para cerrar un Problema."
          />
        </div>
      )}

      {/* Change-specific fields */}
      {isChange && (
        <div className="space-y-3 rounded-md border border-indigo-500/30 bg-indigo-500/5 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-indigo-300 flex items-center gap-1">
            <Wrench className="h-3 w-3" /> Gestión de Cambio
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="itil-change-type" className={FIELD_LABEL}>
                Tipo de cambio <span className="text-destructive">*</span>
              </label>
              <select
                id="itil-change-type"
                value={draft.changeType ?? 'Normal'}
                onChange={(e) => patch('changeType', e.target.value as ItilChangeType)}
                onBlur={commitAutosave}
                disabled={disabled}
                className={INPUT_BASE}
              >
                {CHANGE_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground pt-6">
              <input
                type="checkbox"
                checked={draft.cabApproval ?? false}
                onChange={(e) => {
                  patch('cabApproval', e.target.checked)
                  startTransition(() => commitAutosave())
                }}
                disabled={disabled}
                className="h-3.5 w-3.5 rounded border-border bg-input accent-primary"
              />
              <span>CAB aprobado</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="itil-change-start" className={FIELD_LABEL}>
                Inicio ventana de cambio
              </label>
              <input
                id="itil-change-start"
                type="datetime-local"
                value={draft.changeWindowStart ?? ''}
                onChange={(e) =>
                  patch('changeWindowStart', e.target.value || null)
                }
                onBlur={commitAutosave}
                disabled={disabled}
                className={INPUT_BASE}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="itil-change-end" className={FIELD_LABEL}>
                Fin ventana de cambio
              </label>
              <input
                id="itil-change-end"
                type="datetime-local"
                value={draft.changeWindowEnd ?? ''}
                onChange={(e) =>
                  patch('changeWindowEnd', e.target.value || null)
                }
                onBlur={commitAutosave}
                disabled={disabled}
                className={INPUT_BASE}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="itil-risk-assessment" className={FIELD_LABEL}>
              Evaluación de riesgo
            </label>
            <textarea
              id="itil-risk-assessment"
              value={draft.riskAssessment ?? ''}
              onChange={(e) => patch('riskAssessment', e.target.value || null)}
              onBlur={commitAutosave}
              disabled={disabled}
              className={TEXTAREA_BASE}
              placeholder="Riesgos identificados del cambio. Obligatorio para Normal/Emergency."
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="itil-impl-plan" className={FIELD_LABEL}>
              Plan de implementación <span className="text-destructive">*</span>
            </label>
            <textarea
              id="itil-impl-plan"
              value={draft.implementationPlan ?? ''}
              onChange={(e) =>
                patch('implementationPlan', e.target.value || null)
              }
              onBlur={commitAutosave}
              disabled={disabled}
              className={TEXTAREA_BASE}
              placeholder="Pasos detallados a ejecutar."
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="itil-rollback" className={FIELD_LABEL}>
              Plan de rollback <span className="text-destructive">*</span>
            </label>
            <textarea
              id="itil-rollback"
              value={draft.rollbackPlan ?? ''}
              onChange={(e) => patch('rollbackPlan', e.target.value || null)}
              onBlur={commitAutosave}
              disabled={disabled}
              className={TEXTAREA_BASE}
              placeholder="Cómo revertir si el cambio falla."
            />
          </div>
        </div>
      )}

      {/* Wave R5 · US-9.3 — Selector CMDB · sólo cuando hay taskId */}
      {mode === 'edit' && taskId ? (
        <TaskCISelector
          taskId={taskId}
          initialLinks={ciLinks ?? []}
          disabled={disabled}
        />
      ) : null}
    </section>
  )
}
