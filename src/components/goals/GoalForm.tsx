'use client'

/**
 * Ola P2 · Equipo P2-4 — Formulario crear/editar de Objective.
 *
 * Renderiza inputs para title, description, owner, project (opcional),
 * cycle (con CycleSelector), startDate, endDate, parent (opcional) y
 * status. Valida en cliente con zod equivalente al server action y
 * dispatcha a `createGoal`/`updateGoal`.
 *
 * El padre suele ser una página server-rendered que pasa los catálogos
 * (users, projects, parentCandidates).
 */

import { useState, useTransition } from 'react'
import type { GoalStatus } from '@prisma/client'
import { z } from 'zod'
import { Save, X } from 'lucide-react'
import { CycleSelector } from './CycleSelector'
import {
  createGoal,
  updateGoal,
  type CreateGoalInput,
} from '@/lib/actions/goals'
import { isValidCycle } from '@/lib/okr/progress'

export type GoalDraft = {
  id?: string
  title: string
  description: string
  ownerId: string
  projectId: string | null
  cycle: string
  startDate: string // ISO yyyy-mm-dd
  endDate: string
  parentId: string | null
  status: GoalStatus
}

type Props = {
  initial?: Partial<GoalDraft>
  users: Array<{ id: string; name: string }>
  projects?: Array<{ id: string; name: string }>
  parentCandidates?: Array<{ id: string; title: string; cycle: string }>
  defaultCycle?: string
  onSaved?: (id: string) => void
  onCancel?: () => void
}

const STATUS_OPTIONS: Array<{ value: GoalStatus; label: string }> = [
  { value: 'ON_TRACK', label: 'On track' },
  { value: 'AT_RISK', label: 'En riesgo' },
  { value: 'OFF_TRACK', label: 'Fuera de ruta' },
  { value: 'COMPLETED', label: 'Completado' },
  { value: 'CANCELLED', label: 'Cancelado' },
]

// Esquema de validación cliente. El server action valida de nuevo.
const DRAFT_SCHEMA = z
  .object({
    title: z.string().min(1, 'El título es obligatorio').max(200),
    description: z.string().max(2000),
    ownerId: z.string().min(1, 'Selecciona un owner'),
    projectId: z.string().nullable(),
    cycle: z.string().refine(isValidCycle, 'Ciclo inválido'),
    startDate: z.string().min(1, 'Fecha inicio obligatoria'),
    endDate: z.string().min(1, 'Fecha fin obligatoria'),
    parentId: z.string().nullable(),
    status: z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETED', 'CANCELLED']),
  })
  .refine((v) => new Date(v.startDate).getTime() < new Date(v.endDate).getTime(), {
    message: 'La fecha fin debe ser posterior a la fecha inicio',
    path: ['endDate'],
  })

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function plusMonthsIso(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function GoalForm({
  initial,
  users,
  projects = [],
  parentCandidates = [],
  defaultCycle = `Q${Math.floor(new Date().getUTCMonth() / 3) + 1}-${new Date().getUTCFullYear()}`,
  onSaved,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<GoalDraft>({
    id: initial?.id,
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    ownerId: initial?.ownerId ?? users[0]?.id ?? '',
    projectId: initial?.projectId ?? null,
    cycle: initial?.cycle ?? defaultCycle,
    startDate: initial?.startDate ?? todayIso(),
    endDate: initial?.endDate ?? plusMonthsIso(3),
    parentId: initial?.parentId ?? null,
    status: initial?.status ?? 'ON_TRACK',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)

  const isEdit = !!initial?.id

  function update<K extends keyof GoalDraft>(k: K, v: GoalDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    const parsed = DRAFT_SCHEMA.safeParse(draft)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        next[String(issue.path[0])] = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    const payload: CreateGoalInput = {
      title: parsed.data.title,
      description: parsed.data.description || null,
      ownerId: parsed.data.ownerId,
      projectId: parsed.data.projectId,
      cycle: parsed.data.cycle,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      parentId: parsed.data.parentId,
      status: parsed.data.status,
    }
    start(async () => {
      try {
        if (isEdit && draft.id) {
          await updateGoal(draft.id, payload)
          onSaved?.(draft.id)
        } else {
          const { id } = await createGoal(payload)
          onSaved?.(id)
        }
      } catch (err) {
        setServerError(err instanceof Error ? err.message : 'Error desconocido')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid="goal-form"
    >
      <h3 className="text-sm font-semibold text-foreground">
        {isEdit ? 'Editar objetivo' : 'Nuevo objetivo'}
      </h3>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Título</span>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => update('title', e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
          maxLength={200}
          required
        />
        {errors.title && <span className="text-[11px] text-red-500">{errors.title}</span>}
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Descripción</span>
        <textarea
          value={draft.description}
          onChange={(e) => update('description', e.target.value)}
          className="min-h-[60px] rounded border border-border bg-background px-2 py-1 text-sm"
          maxLength={2000}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Owner</span>
          <select
            value={draft.ownerId}
            onChange={(e) => update('ownerId', e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            required
          >
            <option value="" disabled>
              — Seleccionar —
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          {errors.ownerId && <span className="text-[11px] text-red-500">{errors.ownerId}</span>}
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Proyecto (opcional)</span>
          <select
            value={draft.projectId ?? ''}
            onChange={(e) => update('projectId', e.target.value || null)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">— Sin proyecto —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <CycleSelector
          value={draft.cycle}
          onChange={(c) => update('cycle', c)}
        />

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Estado</span>
          <select
            value={draft.status}
            onChange={(e) => update('status', e.target.value as GoalStatus)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Fecha inicio</span>
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => update('startDate', e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            required
          />
          {errors.startDate && <span className="text-[11px] text-red-500">{errors.startDate}</span>}
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Fecha fin</span>
          <input
            type="date"
            value={draft.endDate}
            onChange={(e) => update('endDate', e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            required
          />
          {errors.endDate && <span className="text-[11px] text-red-500">{errors.endDate}</span>}
        </label>
      </div>

      {parentCandidates.length > 0 && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Objetivo padre (opcional)</span>
          <select
            value={draft.parentId ?? ''}
            onChange={(e) => update('parentId', e.target.value || null)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">— Ninguno —</option>
            {parentCandidates
              .filter((p) => p.id !== draft.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.cycle}] {p.title}
                </option>
              ))}
          </select>
        </label>
      )}

      {serverError && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          {serverError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-1 text-xs hover:bg-accent"
            disabled={pending}
          >
            <X className="h-3 w-3" />
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="goal-form-submit"
        >
          <Save className="h-3 w-3" />
          {pending ? 'Guardando…' : isEdit ? 'Guardar' : 'Crear'}
        </button>
      </div>
    </form>
  )
}
