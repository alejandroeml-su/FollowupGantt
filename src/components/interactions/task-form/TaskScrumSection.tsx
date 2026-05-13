'use client'

/**
 * Fase 1.5 (2026-05-13) · Scrum Task Attributes UI.
 *
 * Captura los campos *de tarea técnica* dentro de una historia de
 * usuario (la propia historia padre se gestiona en UserStorySection):
 *   - taskKind (Dev / Test / Design / Docs / Spike / TechDebt / Bug)
 *   - boardStatus (ToDo / InProgress / InReview / Done)
 *   - hoursEstimate / hoursRemaining / hoursLogged
 *   - components, blockers, dodChecklist
 *   - commits, pullRequests, reviewNotes
 *
 * En `mode='create'`: controlado por padre via onChange.
 * En `mode='edit'`: autosalva onBlur via onAutosave callback.
 */

import { useState, useTransition } from 'react'
import { clsx } from 'clsx'
import { GitBranch, Clock, AlertOctagon, CheckSquare } from 'lucide-react'
import {
  type ScrumAttributes,
  type ScrumTaskKind,
  type ScrumBoardStatus,
  emptyScrumAttributes,
} from '@/lib/scrum/types'

type Props = {
  mode: 'create' | 'edit'
  value: ScrumAttributes | null
  onChange?: (next: ScrumAttributes) => void
  onAutosave?: (next: ScrumAttributes) => void
  disabled?: boolean
  className?: string
}

const TASK_KINDS: ScrumTaskKind[] = [
  'Dev',
  'Test',
  'Design',
  'Docs',
  'Spike',
  'TechDebt',
  'Bug',
]
const BOARD_STATUSES: ScrumBoardStatus[] = [
  'ToDo',
  'InProgress',
  'InReview',
  'Done',
]

const FIELD_LABEL =
  'text-xs font-semibold uppercase tracking-wider text-foreground'
const INPUT_BASE =
  'w-full rounded-md border border-border bg-input py-1.5 px-2 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring'

export function TaskScrumSection({
  mode,
  value,
  onChange,
  onAutosave,
  disabled = false,
  className,
}: Props) {
  const [draft, setDraft] = useState<ScrumAttributes>(
    value ?? emptyScrumAttributes(),
  )
  const [, startTransition] = useTransition()

  function patch<K extends keyof ScrumAttributes>(
    key: K,
    next: ScrumAttributes[K],
  ) {
    const updated = { ...draft, [key]: next }
    setDraft(updated)
    onChange?.(updated)
  }

  function commitAutosave() {
    if (mode !== 'edit' || !onAutosave) return
    startTransition(() => onAutosave(draft))
  }

  const dodPct =
    draft.dodChecklist.length === 0
      ? 0
      : Math.round(
          (draft.dodChecklist.filter((d) => d.checked).length /
            draft.dodChecklist.length) *
            100,
        )

  return (
    <section
      className={clsx('space-y-4 pt-4', className)}
      aria-label="Atributos Scrum"
      data-testid="task-scrum-section"
    >
      <header className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <GitBranch className="h-4 w-4" /> Atributos Scrum
        </h3>
        <span
          className={clsx(
            'rounded px-2 py-0.5 text-[10px] font-black border',
            dodPct === 100
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
          )}
          title="Definition of Done · % completado"
        >
          DoD {dodPct}%
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="scrum-task-kind" className={FIELD_LABEL}>
            Tipo de trabajo <span className="text-destructive">*</span>
          </label>
          <select
            id="scrum-task-kind"
            value={draft.taskKind}
            onChange={(e) => patch('taskKind', e.target.value as ScrumTaskKind)}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          >
            {TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="scrum-board-status" className={FIELD_LABEL}>
            Estado tablero
          </label>
          <select
            id="scrum-board-status"
            value={draft.boardStatus}
            onChange={(e) =>
              patch('boardStatus', e.target.value as ScrumBoardStatus)
            }
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          >
            {BOARD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="scrum-hours-estimate" className={FIELD_LABEL}>
            Estimado (h) <span className="text-destructive">*</span>
          </label>
          <input
            id="scrum-hours-estimate"
            type="number"
            min={0}
            step={0.5}
            value={draft.hoursEstimate}
            onChange={(e) => patch('hoursEstimate', Number(e.target.value))}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="scrum-hours-remaining" className={FIELD_LABEL}>
            Restante (h)
          </label>
          <input
            id="scrum-hours-remaining"
            type="number"
            min={0}
            step={0.5}
            value={draft.hoursRemaining}
            onChange={(e) => patch('hoursRemaining', Number(e.target.value))}
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="scrum-hours-logged" className={FIELD_LABEL}>
            Registrado (h)
          </label>
          <input
            id="scrum-hours-logged"
            type="number"
            min={0}
            step={0.5}
            value={draft.hoursLogged ?? ''}
            onChange={(e) =>
              patch('hoursLogged', e.target.value ? Number(e.target.value) : undefined)
            }
            onBlur={commitAutosave}
            disabled={disabled}
            className={INPUT_BASE}
          />
        </div>
      </div>

      {/* Componentes (CSV) */}
      <div className="space-y-1.5">
        <label htmlFor="scrum-components" className={FIELD_LABEL}>
          Componentes / módulos afectados
        </label>
        <input
          id="scrum-components"
          type="text"
          value={(draft.components ?? []).join(', ')}
          onChange={(e) =>
            patch(
              'components',
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          onBlur={commitAutosave}
          disabled={disabled}
          className={INPUT_BASE}
          placeholder="api, ui, auth, …"
        />
      </div>

      {/* Definition of Done checklist */}
      <div className="space-y-2 rounded-md border border-border bg-subtle/40 p-3">
        <div className="flex items-center justify-between">
          <h4 className={clsx(FIELD_LABEL, 'flex items-center gap-1')}>
            <CheckSquare className="h-3 w-3" /> Definition of Done
          </h4>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = [...draft.dodChecklist, { item: '', checked: false }]
              patch('dodChecklist', next)
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
          >
            + Agregar
          </button>
        </div>
        <ul className="space-y-1.5">
          {draft.dodChecklist.map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={it.checked}
                onChange={(e) => {
                  const next = [...draft.dodChecklist]
                  next[i] = { ...it, checked: e.target.checked }
                  patch('dodChecklist', next)
                  startTransition(() => commitAutosave())
                }}
                disabled={disabled}
                className="h-3.5 w-3.5 rounded border-border bg-input accent-primary"
              />
              <input
                type="text"
                value={it.item}
                onChange={(e) => {
                  const next = [...draft.dodChecklist]
                  next[i] = { ...it, item: e.target.value }
                  patch('dodChecklist', next)
                }}
                onBlur={commitAutosave}
                disabled={disabled}
                placeholder="Ej: Tests unitarios pasan…"
                className={clsx(INPUT_BASE, 'flex-1')}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const next = draft.dodChecklist.filter((_, j) => j !== i)
                  patch('dodChecklist', next)
                  startTransition(() => commitAutosave())
                }}
                className="text-destructive hover:text-destructive/80 text-xs disabled:opacity-50"
                aria-label="Eliminar item"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Blockers */}
      {(draft.blockers ?? []).length > 0 && (
        <div className="space-y-1.5">
          <label className={clsx(FIELD_LABEL, 'flex items-center gap-1')}>
            <AlertOctagon className="h-3 w-3" /> Bloqueos activos
          </label>
          <ul className="space-y-1">
            {(draft.blockers ?? []).map((b, i) => (
              <li
                key={i}
                className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-xs text-foreground"
              >
                {b.description}{' '}
                <span className="text-muted-foreground">
                  (desde {new Date(b.since).toLocaleDateString()})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Commits + PRs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="scrum-commits" className={FIELD_LABEL}>
            Commits (URLs)
          </label>
          <textarea
            id="scrum-commits"
            value={(draft.commits ?? []).join('\n')}
            onChange={(e) =>
              patch(
                'commits',
                e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            onBlur={commitAutosave}
            disabled={disabled}
            className={clsx(INPUT_BASE, 'resize-none min-h-[60px]')}
            placeholder="https://github.com/…"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="scrum-prs" className={FIELD_LABEL}>
            Pull Requests (URLs)
          </label>
          <textarea
            id="scrum-prs"
            value={(draft.pullRequests ?? []).join('\n')}
            onChange={(e) =>
              patch(
                'pullRequests',
                e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            onBlur={commitAutosave}
            disabled={disabled}
            className={clsx(INPUT_BASE, 'resize-none min-h-[60px]')}
            placeholder="https://github.com/…/pull/…"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="scrum-review-notes" className={FIELD_LABEL}>
          Notas de code review
        </label>
        <textarea
          id="scrum-review-notes"
          value={draft.reviewNotes ?? ''}
          onChange={(e) => patch('reviewNotes', e.target.value || null)}
          onBlur={commitAutosave}
          disabled={disabled}
          className={clsx(INPUT_BASE, 'resize-none min-h-[60px]')}
          placeholder="Decisiones, comentarios del revisor…"
        />
      </div>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" /> El campo Story Points y los criterios
        de aceptación se gestionan en la sección Historia de Usuario.
      </p>
    </section>
  )
}
